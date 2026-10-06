import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { SalesUseCases } from "../src/application/sales-use-cases";
import {
  ingredientBundle,
  priceCart,
  refundAmount,
  type CatalogItem,
  type SaleRecord,
} from "../src/domain/sale";
import type {
  Attempt,
  CommandRecord,
  OutboxEvent,
  Receipt,
  SalesStore,
  SalesTransaction,
  StoredRefund,
} from "../src/application/ports";
class MemoryStore {
  sales = new Map<string, SaleRecord>();
  commands = new Map<string, CommandRecord>();
  attempts = new Map<string, Attempt>();
  corrections = new Map<string, StoredRefund>();
  receipts = new Map<string, Receipt>();
  outbox = new Map<string, OutboxEvent>();
  async sale(id: string) {
    return structuredClone(this.sales.get(id) ?? null);
  }
  async command(id: string) {
    return structuredClone(this.commands.get(id) ?? null);
  }
  async attempt(id: string) {
    return structuredClone(this.attempts.get(id) ?? null);
  }
  async refund(id: string) {
    return structuredClone(this.corrections.get(id) ?? null);
  }
  async refunds(id: string) {
    return structuredClone(
      [...this.corrections.values()].filter((r) => r.saleId === id),
    );
  }
  async transaction<T>(work: (tx: SalesTransaction) => Promise<T>) {
    const saved = structuredClone({
      sales: this.sales,
      commands: this.commands,
      attempts: this.attempts,
      corrections: this.corrections,
      receipts: this.receipts,
      outbox: this.outbox,
    });
    const tx: SalesTransaction = {
      sale: (id) => this.sale(id),
      saveSale: async (s) => {
        this.sales.set(s.id, structuredClone(s));
      },
      command: (id) => this.command(id),
      saveCommand: async (c) => {
        this.commands.set(c.id, structuredClone(c));
      },
      attempt: (id) => this.attempt(id),
      saveAttempt: async (a) => {
        this.attempts.set(a.id, structuredClone(a));
      },
      refund: (id) => this.refund(id),
      refunds: (id) => this.refunds(id),
      saveRefund: async (r) => {
        this.corrections.set(r.id, structuredClone(r));
      },
      saveReceipt: async (r) => {
        this.receipts.set(r.saleId, structuredClone(r));
      },
      saveEvent: async (e) => {
        this.outbox.set(e.eventId, structuredClone(e));
      },
    };
    try {
      return await work(tx);
    } catch (e) {
      Object.assign(this, saved);
      throw e;
    }
  }
  async pending() {
    return {
      attempts: [...this.attempts.values()].filter(
        (a) => a.status === "CHECKOUT_PENDING",
      ),
      refunds: [...this.corrections.values()].filter(
        (r) => r.status === "REFUND_PENDING",
      ),
    };
  }
}
function fixture() {
  const product = randomUUID(),
    milk = randomUUID(),
    menu = randomUUID(),
    location = randomUUID();
  const item: CatalogItem = {
    id: menu,
    name: "Latte",
    category: "Coffee",
    currency: "USD",
    priceMinor: 400,
    version: 0,
    recipeRevision: 1,
    archivedAt: null,
    ingredients: [
      { productId: product, name: "Coffee", unit: "kg", quantity: 0.018 },
      { productId: milk, name: "Milk", unit: "L", quantity: 0.2 },
    ],
  };
  const store = new MemoryStore();
  const operations = new Map<
    string,
    {
      id: string;
      status: "COMMITTED" | "REJECTED";
      error?: { code: string; message: string };
    }
  >();
  let consumeCalls = 0,
    returnCalls = 0,
    mode = "success";
  let consumed: any;
  const catalog = {
    menu: async () => structuredClone(item),
    activeProduct: async () => {},
  };
  const inventory = {
    status: async (id: string) => operations.get(id) ?? null,
    consume: async (body: any) => {
      consumeCalls++;
      consumed = structuredClone(body);
      if (mode === "before") throw new Error("offline");
      const result =
        mode === "reject"
          ? {
              id: body.operationId,
              status: "REJECTED" as const,
              error: { code: "INSUFFICIENT_STOCK", message: "Milk shortage" },
            }
          : { id: body.operationId, status: "COMMITTED" as const };
      operations.set(body.operationId, result);
      if (mode === "after") throw new Error("response lost");
      return result;
    },
    returnStock: async (body: any) => {
      returnCalls++;
      if (mode === "before") throw new Error("offline");
      const result = { id: body.operationId, status: "COMMITTED" as const };
      operations.set(body.operationId, result);
      if (mode === "after") throw new Error("lost return");
      return result;
    },
  };
  const sales = new SalesUseCases(
    store as unknown as SalesStore,
    catalog,
    inventory,
    "USD",
  );
  const draft = () =>
    sales.create(randomUUID(), {
      locationId: location,
      lines: [{ menuItemId: menu, quantity: 3 }],
    });
  return {
    sales,
    store,
    item,
    operations,
    draft,
    mode: (value: string) => {
      mode = value;
    },
    calls: () => ({ consumeCalls, returnCalls }),
    consumed: () => consumed,
    location,
    menu,
  };
}
describe("Sales numeric/domain rules", () => {
  it("combines ingredients using exact milliunits and prices using safe minor integers", () => {
    const f = fixture();
    const result = priceCart(
      [
        { menuItemId: f.menu, quantity: 1 },
        { menuItemId: f.menu, quantity: 2 },
      ],
      [f.item],
      "USD",
      () => randomUUID(),
    );
    expect(result.totalMinor).toBe(1200);
    expect(
      ingredientBundle(result.lines)
        .map((l) => l.quantity)
        .sort(),
    ).toEqual([0.054, 0.6]);
  });
  it("rejects price and ingredient multiplication overflow", () => {
    const f = fixture();
    f.item.priceMinor = Number.MAX_SAFE_INTEGER;
    expect(() =>
      priceCart([{ menuItemId: f.menu, quantity: 2 }], [f.item], "USD", () =>
        randomUUID(),
      ),
    ).toThrow("Line total");
    f.item.priceMinor = 1;
    expect(() =>
      priceCart(
        [{ menuItemId: f.menu, quantity: Number.MAX_SAFE_INTEGER }],
        [f.item],
        "USD",
        () => randomUUID(),
      ),
    ).toThrow("Ingredient bundle");
  });
});
describe("Sales durable coordinator", () => {
  it("replays the original rejected checkout after editing and completing a later attempt", async () => {
    const f = fixture(), draft = await f.draft(), rejectedKey = randomUUID();
    f.mode("reject");
    const rejected = await f.sales.checkout(draft.id, rejectedKey, {expectedVersion:0,tender:"CASH"});
    f.item.priceMinor = 550;
    const edited = await f.sales.edit(draft.id, {expectedVersion:rejected.version,locationId:f.location,lines:[{menuItemId:f.menu,quantity:1}]});
    f.mode("success");
    const completed = await f.sales.checkout(draft.id, randomUUID(), {expectedVersion:edited.version,tender:"CARD"});
    expect(completed.status).toBe("COMPLETED");
    expect(completed.totalMinor).toBe(550);
    expect(await f.sales.checkout(draft.id, rejectedKey, {expectedVersion:0,tender:"CASH"})).toEqual(rejected);
    expect((await f.sales.get(draft.id)).status).toBe("COMPLETED");
    expect(f.calls().consumeCalls).toBe(2);
    expect(f.store.receipts.size).toBe(1);
    expect(f.store.outbox.size).toBe(1);
    // Legacy attempts have no frozen reply. Preserve their actual rejection,
    // rather than misreporting the newer completed cart as their outcome.
    const legacy = f.store.attempts.get(rejectedKey)!;
    delete legacy.snapshot;
    delete legacy.result;
    await expect(f.sales.checkout(draft.id, rejectedKey, {expectedVersion:0,tender:"CASH"})).rejects.toMatchObject({code:"INSUFFICIENT_STOCK"});
  });
  it("creates exactly one receipt/event and replays without new consumption", async () => {
    const f = fixture(),
      draft = await f.draft(),
      key = randomUUID();
    const result = await f.sales.checkout(draft.id, key, {
      expectedVersion: 0,
      tender: "CASH",
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.totalMinor).toBe(1200);
    expect(f.store.receipts.size).toBe(1);
    expect(f.store.outbox.size).toBe(1);
    await f.sales.checkout(draft.id, key, {
      expectedVersion: 0,
      tender: "CASH",
    });
    expect(f.calls().consumeCalls).toBe(1);
    await expect(
      f.sales.checkout(draft.id, key, { expectedVersion: 0, tender: "CARD" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("persists before dispatch and recovers after offline Inventory using frozen configuration", async () => {
    const f = fixture(),
      draft = await f.draft();
    f.mode("before");
    const result = await f.sales.checkout(draft.id, randomUUID(), {
      expectedVersion: 0,
      tender: "CASH",
    });
    expect(result.status).toBe("CHECKOUT_PENDING");
    f.item.priceMinor = 999;
    f.item.ingredients[1].quantity = 0.9;
    f.mode("success");
    await f.sales.recover();
    expect((await f.sales.get(draft.id)).totalMinor).toBe(1200);
    expect(
      f
        .consumed()
        .lines.map((l: any) => l.quantity)
        .sort(),
    ).toEqual([0.054, 0.6]);
    expect(f.store.receipts.size).toBe(1);
  });
  it("recovers a committed Inventory operation after a lost response without redispatch", async () => {
    const f = fixture(),
      draft = await f.draft();
    f.mode("after");
    expect(
      (
        await f.sales.checkout(draft.id, randomUUID(), {
          expectedVersion: 0,
          tender: "CARD",
        })
      ).status,
    ).toBe("CHECKOUT_PENDING");
    f.mode("success");
    await f.sales.recover();
    await f.sales.recover();
    expect((await f.sales.get(draft.id)).status).toBe("COMPLETED");
    expect(f.calls().consumeCalls).toBe(1);
    expect(f.store.outbox.size).toBe(1);
  });
  it("requires renewed review for catalog changes before preparation", async () => {
    const f = fixture(),
      draft = await f.draft();
    f.item.version++;
    f.item.priceMinor = 450;
    await expect(
      f.sales.checkout(draft.id, randomUUID(), {
        expectedVersion: 0,
        tender: "CASH",
      }),
    ).rejects.toMatchObject({ code: "PRICE_REVIEW_REQUIRED" });
    expect(f.store.attempts.size).toBe(0);
    expect(f.calls().consumeCalls).toBe(0);
  });
  it("retains rejection without receipt and needs deliberate edit/new identity", async () => {
    const f = fixture(),
      draft = await f.draft();
    f.mode("reject");
    const result = await f.sales.checkout(draft.id, randomUUID(), {
      expectedVersion: 0,
      tender: "CASH",
    });
    expect(result.status).toBe("REJECTED");
    expect(result.error?.code).toBe("INSUFFICIENT_STOCK");
    expect(f.store.receipts.size).toBe(0);
    expect(f.store.outbox.size).toBe(0);
    await expect(
      f.sales.checkout(draft.id, randomUUID(), {
        expectedVersion: result.version,
        tender: "CASH",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SALE_STATE" });
    const edited = await f.sales.edit(draft.id, {
      expectedVersion: result.version,
      locationId: f.location,
      lines: [{ menuItemId: f.menu, quantity: 1 }],
    });
    expect(edited.status).toBe("DRAFT");
    expect(f.store.attempts.size).toBe(1);
  });
  it("no-restock refund is monetary only and cumulative refund is bounded by original quantities", async () => {
    const f = fixture(),
      draft = await f.draft();
    const sale = await f.sales.checkout(draft.id, randomUUID(), {
      expectedVersion: 0,
      tender: "CASH",
    });
    const key = randomUUID(),
      input = {
        lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }],
        reason: "Prepared drink",
        restock: false,
      };
    const refund = await f.sales.refund(sale.id, key, input);
    expect(refund.amountMinor).toBe(400);
    expect(f.calls().returnCalls).toBe(0);
    await f.sales.refund(sale.id, key, input);
    expect(f.store.corrections.size).toBe(1);
    await expect(
      f.sales.refund(sale.id, randomUUID(), {
        ...input,
        lines: [{ saleLineId: sale.lines[0].id, quantity: 3 }],
      }),
    ).rejects.toMatchObject({ code: "REFUND_LIMIT_EXCEEDED" });
    expect(f.store.receipts.get(sale.id)?.sale.version).toBe(sale.version);
  });
  it("uncertain stock returns block overlap then recover once through original consumption", async () => {
    const f = fixture(),
      draft = await f.draft();
    const sale = await f.sales.checkout(draft.id, randomUUID(), {
      expectedVersion: 0,
      tender: "CASH",
    });
    f.mode("after");
    const input = {
      lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }],
      reason: "Unprepared order",
      restock: true,
    };
    const refund = await f.sales.refund(sale.id, randomUUID(), input);
    expect(refund.status).toBe("REFUND_PENDING");
    await expect(
      f.sales.refund(sale.id, randomUUID(), input),
    ).rejects.toMatchObject({ code: "OPERATION_PENDING" });
    f.mode("success");
    await f.sales.recover();
    expect((await f.store.refund(refund.id))?.status).toBe("COMPLETED");
    expect(f.calls().returnCalls).toBe(1);
    expect(f.store.outbox.size).toBe(2);
  });
});
