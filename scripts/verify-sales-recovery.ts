import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoSalesStore } from "../apps/sales-service/src/infrastructure/mongo-sales-store";
import { SalesUseCases } from "../apps/sales-service/src/application/sales-use-cases";
import type { CatalogItem } from "../apps/sales-service/src/domain/sale";
import type {
  ConsumeCommand,
  InventoryPort,
  OperationOutcome,
  SalesStore,
  SalesTransaction,
} from "../apps/sales-service/src/application/ports";

async function main() {
  const uri =
    process.env.SALES_TEST_MONGO_URI ??
    process.env.MONGO_URI ??
    "mongodb://127.0.0.1:27017/?replicaSet=rs0";
  const database = `stockflow_sales_verify_${randomUUID().replaceAll("-", "")}`;
  const client = await MongoClient.connect(uri, {
    serverSelectionTimeoutMS: 2000,
  });
  try {
    const store = new MongoSalesStore(client, database);
    await store.setup();
    const menuId = randomUUID(),
      locationId = randomUUID();
    const menu: CatalogItem = {
      id: menuId,
      name: "Latte",
      category: "Coffee",
      priceMinor: 400,
      currency: "USD",
      version: 1,
      recipeRevision: 1,
      archivedAt: null,
      ingredients: [
        {
          productId: randomUUID(),
          name: "Coffee",
          unit: "kg",
          quantity: 0.018,
        },
        { productId: randomUUID(), name: "Milk", unit: "L", quantity: 0.2 },
      ],
    };
    const catalog = {
      menu: async () => structuredClone(menu),
      activeProduct: async () => {},
    };
    const outcomes = new Map<string, OperationOutcome>();
    const inputs = new Map<string, ConsumeCommand>();
    let mode: "success" | "before" | "after" = "success";
    let returnMode: "success" | "after" = "success";
    let consumeCalls = 0,
      returnCalls = 0;
    const inventory: InventoryPort = {
      status: async (id) => outcomes.get(id) ?? null,
      consume: async (body) => {
        consumeCalls++;
        if (mode === "before")
          throw new Error("Injected crash before Inventory dispatch");
        inputs.set(body.operationId, structuredClone(body));
        const outcome: OperationOutcome = {
          id: body.operationId,
          status: "COMMITTED",
        };
        outcomes.set(body.operationId, outcome);
        if (mode === "after")
          throw new Error("Injected loss after Inventory commit");
        return outcome;
      },
      returnStock: async (body) => {
        returnCalls++;
        const outcome: OperationOutcome = {
          id: body.operationId,
          status: "COMMITTED",
        };
        outcomes.set(body.operationId, outcome);
        if (returnMode === "after")
          throw new Error("Injected lost return response");
        return outcome;
      },
    };
    const service = () => new SalesUseCases(store, catalog, inventory, "USD");
    const create = async (quantity = 3) =>
      service().create(randomUUID(), {
        locationId,
        lines: [{ menuItemId: menuId, quantity }],
      });
    async function inspect(saleId: string) {
      assert.equal(
        await store.db
          .collection("checkout_attempts")
          .countDocuments({ saleId }),
        1,
      );
      assert.equal(
        await store.db.collection("receipts").countDocuments({ saleId }),
        1,
      );
      assert.equal(
        await store.db
          .collection("outbox")
          .countDocuments({
            "payload.saleId": saleId,
            "payload.eventType": "SaleCompleted",
          }),
        1,
      );
      assert.equal((await store.sale(saleId))?.status, "COMPLETED");
    }

    const rollback = await create();
    await assert.rejects(
      store.transaction(async (tx) => {
        const sale = (await tx.sale(rollback.id))!;
        sale.status = "CANCELLED";
        await tx.saveSale(sale);
        await tx.saveCommand({
          id: randomUUID(),
          kind: "INJECTED",
          fingerprint: "test",
          saleId: sale.id,
        });
        throw new Error("Injected transaction failure");
      }),
    );
    assert.equal((await store.sale(rollback.id))?.status, "DRAFT");
    assert.equal(
      await store.db
        .collection("sales_commands")
        .countDocuments({ kind: "INJECTED" }),
      0,
    );

    const createKey = randomUUID();
    const drafts = await Promise.all(
      Array.from({ length: 8 }, () =>
        service().create(createKey, {
          locationId,
          lines: [{ menuItemId: menuId, quantity: 3 }],
        }),
      ),
    );
    assert.equal(new Set(drafts.map((d) => d.id)).size, 1);
    const checkoutKey = randomUUID();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        service().checkout(drafts[0].id, checkoutKey, {
          expectedVersion: 0,
          tender: "CASH",
        }),
      ),
    );
    await inspect(drafts[0].id);

    for (const fault of ["before", "after"] as const) {
      const draft = await create();
      mode = fault;
      const callsBefore = consumeCalls;
      const pending = await service().checkout(draft.id, randomUUID(), {
        expectedVersion: 0,
        tender: "CARD",
      });
      assert.equal(pending.status, "CHECKOUT_PENDING");
      assert.equal(
        await store.db
          .collection("receipts")
          .countDocuments({ saleId: draft.id }),
        0,
      );
      const operationId = pending.operationId!;
      const originalPrice = menu.priceMinor;
      menu.priceMinor = 900;
      menu.recipeRevision++;
      mode = "success";
      await service().recover();
      await inspect(draft.id);
      assert.equal((await store.sale(draft.id))?.totalMinor, 1200);
      assert.deepEqual(
        inputs
          .get(operationId)
          ?.lines.map((l) => l.quantity)
          .sort(),
        [0.054, 0.6],
      );
      assert.equal(consumeCalls - callsBefore, fault === "after" ? 1 : 2);
      menu.priceMinor = originalPrice;
      menu.recipeRevision--;
    }

    const draft = await create();
    let failOnce = true;
    const faultStore = new Proxy(store, {
      get(target, property) {
        if (property === "transaction")
          return async (work: (tx: SalesTransaction) => Promise<unknown>) =>
            target.transaction((tx) =>
              work(
                new Proxy(tx, {
                  get(real, key) {
                    if (key === "saveReceipt")
                      return async () => {
                        if (failOnce) {
                          failOnce = false;
                          throw new Error(
                            "Injected crash before Sales finalization",
                          );
                        }
                      };
                    const value = Reflect.get(real, key);
                    return typeof value === "function"
                      ? value.bind(real)
                      : value;
                  },
                }),
              ),
            );
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as SalesStore;
    await assert.rejects(
      new SalesUseCases(faultStore, catalog, inventory, "USD").checkout(
        draft.id,
        randomUUID(),
        { expectedVersion: 0, tender: "CASH" },
      ),
    );
    assert.equal((await store.sale(draft.id))?.status, "CHECKOUT_PENDING");
    assert.equal(
      await store.db
        .collection("receipts")
        .countDocuments({ saleId: draft.id }),
      0,
    );
    await service().recover();
    await inspect(draft.id);

    const completed = (await store.sale(draft.id))!,
      lineId = completed.lines[0].id;
    const noRestock = await service().refund(completed.id, randomUUID(), {
      lines: [{ saleLineId: lineId, quantity: 1 }],
      reason: "Prepared drink refund",
      restock: false,
    });
    assert.equal(noRestock.amountMinor, 400);
    assert.equal(returnCalls, 0);
    returnMode = "after";
    const refundKey = randomUUID();
    const pendingReturn = await service().refund(completed.id, refundKey, {
      lines: [{ saleLineId: lineId, quantity: 1 }],
      reason: "Unprepared item returned",
      restock: true,
    });
    assert.equal(pendingReturn.status, "REFUND_PENDING");
    await assert.rejects(
      service().refund(completed.id, randomUUID(), {
        lines: [{ saleLineId: lineId, quantity: 1 }],
        reason: "Overlap",
        restock: false,
      }),
      { code: "OPERATION_PENDING" },
    );
    returnMode = "success";
    await service().recover();
    assert.equal((await store.refund(refundKey))?.status, "COMPLETED");
    assert.equal(returnCalls, 1);
    const competing = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        service().refund(completed.id, randomUUID(), {
          lines: [{ saleLineId: lineId, quantity: 1 }],
          reason: "Final item correction",
          restock: false,
        }),
      ),
    );
    assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await store.refunds(completed.id))
        .filter((r) => r.status === "COMPLETED")
        .reduce((sum, r) => sum + r.amountMinor, 0),
      1200,
    );
    assert.equal((await store.receipt(completed.id))?.sale.totalMinor, 1200);
    console.log(
      "Sales verification passed: real Mongo rollback, concurrent identity/receipt/outbox uniqueness, restart recovery before dispatch/after Inventory commit/before Sales finalization, frozen recipes/prices, no-restock and explicit-return refund recovery, overlap and cumulative limits.",
    );
  } finally {
    if (!/^stockflow_sales_verify_[0-9a-f]{32}$/.test(database))
      throw new Error("Unsafe Sales verification database name");
    await client.db(database).dropDatabase();
    await client.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
