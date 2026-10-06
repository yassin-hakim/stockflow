import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { MongoSalesStore } from "../src/infrastructure/mongo-sales-store";
import { SalesUseCases } from "../src/application/sales-use-cases";
import type { CatalogItem } from "../src/domain/sale";
import type {
  ConsumeCommand,
  OperationOutcome,
} from "../src/application/ports";
const uri = process.env.SALES_TEST_MONGO_URI;
describe.skipIf(!uri)("Sales real Mongo transactions and report facts", () => {
  const database = `stockflow_sales_it_${randomUUID().replaceAll("-", "")}`;
  let client: MongoClient, store: MongoSalesStore, sales: SalesUseCases;
  const menu = randomUUID(),
    location = randomUUID();
  const item: CatalogItem = {
    id: menu,
    name: "Latte",
    category: "Coffee",
    priceMinor: 400,
    currency: "USD",
    version: 0,
    recipeRevision: 1,
    archivedAt: null,
    ingredients: [
      { productId: randomUUID(), name: "Coffee", unit: "kg", quantity: 0.018 },
    ],
  };
  const committed = new Map<string, OperationOutcome>();
  beforeAll(async () => {
    client = await MongoClient.connect(uri!, {
      serverSelectionTimeoutMS: 2000,
    });
    store = new MongoSalesStore(client, database);
    await store.setup();
    sales = new SalesUseCases(
      store,
      { menu: async () => item, activeProduct: async () => {} },
      {
        status: async (id) => committed.get(id) ?? null,
        consume: async (body) => {
          const outcome: OperationOutcome = {
            id: body.operationId,
            status: "COMMITTED",
          };
          committed.set(body.operationId, outcome);
          return outcome;
        },
        returnStock: async (body) => ({
          id: body.operationId,
          status: "COMMITTED",
        }),
      },
      "USD",
    );
  });
  afterAll(async () => {
    if (client) {
      if (!database.startsWith("stockflow_sales_it_"))
        throw new Error("Unsafe test database");
      await client.db(database).dropDatabase();
      await client.close();
    }
  });
  it("concurrent same-key creates/checkouts finalize one receipt, attempt and completion outbox", async () => {
    const key = randomUUID(),
      input = {
        locationId: location,
        lines: [{ menuItemId: menu, quantity: 3 }],
      };
    const drafts = await Promise.all(
      Array.from({ length: 6 }, () => sales.create(key, input)),
    );
    expect(new Set(drafts.map((d) => d.id)).size).toBe(1);
    const draft = drafts[0],
      checkoutKey = randomUUID();
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        sales.checkout(draft.id, checkoutKey, {
          expectedVersion: 0,
          tender: "CASH",
        }),
      ),
    );
    expect(outcomes.every((o) => o.status === "COMPLETED")).toBe(true);
    expect(
      await store.db
        .collection("receipts")
        .countDocuments({ saleId: draft.id }),
    ).toBe(1);
    expect(
      await store.db
        .collection("checkout_attempts")
        .countDocuments({ saleId: draft.id }),
    ).toBe(1);
    expect(
      await store.db
        .collection("outbox")
        .countDocuments({
          "payload.saleId": draft.id,
          "payload.eventType": "SaleCompleted",
        }),
    ).toBe(1);
    await sales.refund(draft.id, randomUUID(), {
      lines: [{ saleLineId: outcomes[0].lines[0].id, quantity: 1 }],
      reason: "Prepared drink",
      restock: false,
    });
    const report = await store.report(
      {
        from: "2020-01-01T00:00:00.000Z",
        to: "2099-01-01T00:00:00.000Z",
        locationId: location,
        limit: 1,
      },
      "USD",
    );
    expect(report.grossMinor).toBe(1200);
    expect(report.refundMinor).toBe(400);
    expect(report.netMinor).toBe(800);
    expect(report.soldItems).toBe(3);
    expect(report.refundedItems).toBe(1);
    expect(report.items).toHaveLength(1);
    expect(report.nextCursor).toBeTruthy();
    const second = await store.report(
      {
        from: report.from,
        to: report.to,
        locationId: location,
        limit: 1,
        cursor: report.nextCursor!,
      },
      "USD",
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0].kind).not.toBe(report.items[0].kind);
    expect(second.items[0].lines[0].name).toBe("Latte");
  });
  it("competing excessive refunds reserve sold items atomically", async () => {
    const draft = await sales.create(randomUUID(), {
      locationId: location,
      lines: [{ menuItemId: menu, quantity: 1 }],
    });
    const sale = await sales.checkout(draft.id, randomUUID(), {
      expectedVersion: 0,
      tender: "CARD",
    });
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        sales.refund(sale.id, randomUUID(), {
          lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }],
          reason: "Correction",
          restock: false,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await store.refunds(sale.id)).filter((r) => r.status === "COMPLETED"),
    ).toHaveLength(1);
  });
  it('rotates failed pending checkouts past the bounded batch so a newer ready attempt recovers',async()=>{
    const failing=new SalesUseCases(store,sales.catalog,{status:async()=>null,consume:async()=>{throw new Error('offline');},returnStock:async()=>{throw new Error('offline');}},'USD');
    const created: {id:string;operationId:string}[]=[];
    for(let index=0;index<26;index++){
      const draft=await failing.create(randomUUID(),{locationId:location,lines:[{menuItemId:menu,quantity:1}]});
      const result=await failing.checkout(draft.id,randomUUID(),{expectedVersion:0,tender:'CASH'});
      created.push({id:draft.id,operationId:result.operationId!});
      await store.db.collection('checkout_attempts').updateOne({saleId:draft.id},{$set:{updatedAt:index===25?'2001-01-01T00:00:00.000Z':'2000-01-01T00:00:00.000Z'}});
    }
    const ready=created[25];const recovery=new SalesUseCases(store,sales.catalog,{status:async id=>id===ready.operationId?{id,status:'COMMITTED'}:null,consume:async()=>{throw new Error('still offline');},returnStock:async()=>{throw new Error('still offline');}},'USD');
    await recovery.recover();expect((await store.sale(ready.id))?.status).toBe('CHECKOUT_PENDING');
    await recovery.recover();expect((await store.sale(ready.id))?.status).toBe('COMPLETED');
    await store.db.collection('checkout_attempts').updateMany({saleId:{$in:created.slice(0,25).map(row=>row.id)}},{$set:{status:'REJECTED'}});
  },30000);
  it('rotates failed pending stock returns and completes a newer correction without browser input',async()=>{
    const unavailable=new SalesUseCases(store,sales.catalog,{status:async()=>null,consume:async()=>{throw new Error('offline');},returnStock:async()=>{throw new Error('offline');}},'USD');
    const corrections: {id:string;operationId:string}[]=[];
    for(let index=0;index<26;index++){
      const draft=await sales.create(randomUUID(),{locationId:location,lines:[{menuItemId:menu,quantity:1}]});
      const sale=await sales.checkout(draft.id,randomUUID(),{expectedVersion:0,tender:'CASH'});
      const refund=await unavailable.refund(sale.id,randomUUID(),{lines:[{saleLineId:sale.lines[0].id,quantity:1}],reason:'Return',restock:true});
      corrections.push({id:refund.id,operationId:refund.operationId!});
      await store.db.collection('refunds').updateOne({id:refund.id},{$set:{updatedAt:index===25?'2001-01-01T00:00:00.000Z':'2000-01-01T00:00:00.000Z'}});
    }
    const ready=corrections[25];const recovery=new SalesUseCases(store,sales.catalog,{status:async id=>id===ready.operationId?{id,status:'COMMITTED'}:null,consume:async()=>{throw new Error('offline');},returnStock:async()=>{throw new Error('offline');}},'USD');
    await recovery.recover();expect((await store.refund(ready.id))?.status).toBe('REFUND_PENDING');
    await recovery.recover();expect((await store.refund(ready.id))?.status).toBe('COMPLETED');
  },30000);
  it('rejects relabeling historical report money under a changed configured currency',async()=>{
    await expect(store.report({from:'2020-01-01T00:00:00.000Z',to:'2099-01-01T00:00:00.000Z',limit:25},'EUR')).rejects.toMatchObject({code:'CURRENCY_MISMATCH'});
  });
});
