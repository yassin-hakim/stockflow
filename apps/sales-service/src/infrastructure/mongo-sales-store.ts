import {
  MongoClient,
  MongoError,
  type ClientSession,
  type Db,
  type Document,
} from "mongodb";
import type { RefundRecord, SaleRecord } from "../domain/sale";
import { SalesError } from "../domain/sale";
import type {
  Attempt,
  CommandRecord,
  OutboxEvent,
  Receipt,
  ReportQuery,
  SalesReport,
  SalesStore,
  SalesTransaction,
  StoredRefund,
} from "../application/ports";

function clean<T>(row: (T & { _id?: unknown }) | null): T | null {
  if (!row) return null;
  const { _id, ...value } = row;
  return value as T;
}
function cursor(value: { time: string; id: string; kind?: string }): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function parseCursor(
  value?: string,
): { time: string; id: string; kind?: string } | null {
  if (!value) return null;
  try {
    const result = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      typeof result.time !== "string" ||
      !/^\d{4}-/.test(result.time) ||
      typeof result.id !== "string"
    )
      throw new Error();
    return result;
  } catch {
    throw new SalesError("INVALID_REQUEST", "Invalid pagination cursor.", 400);
  }
}
export class MongoSalesStore implements SalesStore {
  readonly db: Db;
  constructor(
    private readonly client: MongoClient,
    database = "stockflow_sales",
  ) {
    this.db = client.db(database);
  }
  async setup(): Promise<void> {
    const version = await this.db
      .collection("schema_versions")
      .findOne({ owner: "sales" });
    if (version && version.version !== 1)
      throw new Error("Unsupported Sales schema version.");
    await this.db
      .collection("schema_versions")
      .updateOne(
        { owner: "sales" },
        { $setOnInsert: { owner: "sales", version: 1 } },
        { upsert: true },
      );
    await Promise.all([
      this.db.collection("sales").createIndex({ id: 1 }, { unique: true }),
      this.db
        .collection("sales")
        .createIndex({ status: 1, createdAt: -1, id: -1 }),
      this.db
        .collection("sales")
        .createIndex({ locationId: 1, completedAt: -1 }),
      this.db
        .collection("sales")
        .createIndex(
          { receiptReference: 1 },
          {
            unique: true,
            partialFilterExpression: { receiptReference: { $type: "string" } },
          },
        ),
      this.db
        .collection("sales_commands")
        .createIndex({ id: 1 }, { unique: true }),
      this.db
        .collection("checkout_attempts")
        .createIndex({ id: 1 }, { unique: true }),
      this.db
        .collection("checkout_attempts")
        .createIndex({ "command.operationId": 1 }, { unique: true }),
      this.db
        .collection("checkout_attempts")
        .createIndex({ status: 1, updatedAt: 1 }),
      this.db.collection("refunds").createIndex({ id: 1 }, { unique: true }),
      this.db.collection("refunds").createIndex({ saleId: 1, createdAt: -1 }),
      this.db.collection("refunds").createIndex({ status: 1, updatedAt: 1 }),
      this.db
        .collection("refunds")
        .createIndex(
          { operationId: 1 },
          {
            unique: true,
            partialFilterExpression: { operationId: { $type: "string" } },
          },
        ),
      this.db
        .collection("receipts")
        .createIndex({ saleId: 1 }, { unique: true }),
      this.db
        .collection("receipts")
        .createIndex({ reference: 1 }, { unique: true }),
      this.db
        .collection("outbox")
        .createIndex({ eventId: 1 }, { unique: true }),
      this.db
        .collection("outbox")
        .createIndex({ publishedAt: 1, nextAttemptAt: 1 }),
    ]);
  }
  private async read<T>(
    collection: string,
    query: Document,
    session?: ClientSession,
  ): Promise<T | null> {
    return clean(
      (await this.db.collection(collection).findOne(query, { session })) as
        (T & { _id: unknown }) | null,
    );
  }
  sale(id: string) {
    return this.read<SaleRecord>("sales", { id });
  }
  refund(id: string) {
    return this.read<StoredRefund>("refunds", { id });
  }
  command(id: string) {
    return this.read<CommandRecord>("sales_commands", { id });
  }
  attempt(id: string) {
    return this.read<Attempt>("checkout_attempts", { id });
  }
  receipt(saleId: string) {
    return this.read<Receipt>("receipts", { saleId });
  }
  async refunds(saleId: string) {
    return (
      await this.db
        .collection("refunds")
        .find({ saleId })
        .sort({ createdAt: -1, id: -1 })
        .limit(10000)
        .toArray()
    ).map((r) => clean(r) as unknown as StoredRefund);
  }
  async transaction<T>(work: (tx: SalesTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.client.startSession();
      try {
        return (await session.withTransaction(
          async () => {
            const read = <R>(collection: string, query: Document) =>
              this.read<R>(collection, query, session);
            const replace = async (
              collection: string,
              key: Document,
              value: unknown,
            ) => {
              await this.db
                .collection(collection)
                .replaceOne(key, value as Document, { upsert: true, session });
            };
            const tx: SalesTransaction = {
              sale: (id) => read<SaleRecord>("sales", { id }),
              saveSale: (s) => replace("sales", { id: s.id }, s),
              command: (id) => read<CommandRecord>("sales_commands", { id }),
              saveCommand: async (c) => {
                await this.db
                  .collection("sales_commands")
                  .insertOne(c as unknown as Document, { session });
              },
              attempt: (id) => read<Attempt>("checkout_attempts", { id }),
              saveAttempt: (a) => replace("checkout_attempts", { id: a.id }, a),
              refund: (id) => read<StoredRefund>("refunds", { id }),
              refunds: async (saleId) =>
                (
                  await this.db
                    .collection("refunds")
                    .find({ saleId }, { session })
                    .limit(10000)
                    .toArray()
                ).map((r) => clean(r) as unknown as StoredRefund),
              saveRefund: (r) => replace("refunds", { id: r.id }, r),
              saveReceipt: async (r) => {
                await this.db
                  .collection("receipts")
                  .insertOne(r as unknown as Document, { session });
              },
              saveEvent: async (e) => {
                await this.db
                  .collection("outbox")
                  .insertOne(e as unknown as Document, { session });
              },
            };
            return work(tx);
          },
          {
            readConcern: { level: "snapshot" },
            writeConcern: { w: "majority" },
          },
        )) as T;
      } catch (error) {
        if (error instanceof MongoError && error.code === 11000 && attempt < 4)
          continue;
        throw error;
      } finally {
        await session.endSession();
      }
    }
    throw new SalesError(
      "SERVICE_UNAVAILABLE",
      "Sales transaction retry exhausted.",
      503,
    );
  }
  async list(query: {
    limit: number;
    cursor?: string;
    status?: string;
    locationId?: string;
    search?: string;
  }) {
    const match: Document = {};
    if (query.status) match.status = query.status;
    if (query.locationId) match.locationId = query.locationId;
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      match.$or = [
        { id: { $regex: escaped, $options: "i" } },
        { receiptReference: { $regex: escaped, $options: "i" } },
      ];
    }
    const after = parseCursor(query.cursor);
    if (after)
      match.$and = [
        {
          $or: [
            { createdAt: { $lt: after.time } },
            { createdAt: after.time, id: { $lt: after.id } },
          ],
        },
      ];
    const rows = (
      await this.db
        .collection("sales")
        .find(match)
        .sort({ createdAt: -1, id: -1 })
        .limit(query.limit + 1)
        .toArray()
    ).map((r) => clean(r) as unknown as SaleRecord);
    const more = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        more && last ? cursor({ time: last.createdAt, id: last.id }) : null,
    };
  }
  async pending(limit: number) {
    const [attempts, refunds] = await Promise.all([
      this.db
        .collection("checkout_attempts")
        .find({ status: "CHECKOUT_PENDING" })
        .sort({ updatedAt: 1, id: 1 })
        .limit(limit)
        .toArray(),
      this.db
        .collection("refunds")
        .find({ status: "REFUND_PENDING" })
        .sort({ updatedAt: 1, id: 1 })
        .limit(limit)
        .toArray(),
    ]);
    return {
      attempts: attempts.map((r) => clean(r) as unknown as Attempt),
      refunds: refunds.map((r) => clean(r) as unknown as StoredRefund),
    };
  }
  private reportPipeline(query: ReportQuery): Document[] {
    const saleMatch: Document = {
      status: "COMPLETED",
      completedAt: { $gte: query.from, $lt: query.to },
    };
    if (query.locationId) saleMatch.locationId = query.locationId;
    const refunds: Document[] = [
      {
        $match: {
          status: "COMPLETED",
          updatedAt: { $gte: query.from, $lt: query.to },
        },
      },
      {
        $lookup: {
          from: "sales",
          localField: "saleId",
          foreignField: "id",
          as: "sale",
        },
      },
      { $unwind: "$sale" },
    ];
    if (query.locationId)
      refunds.push({ $match: { "sale.locationId": query.locationId } });
    const originalLine = {
      $arrayElemAt: [
        {
          $filter: {
            input: "$sale.lines",
            as: "original",
            cond: { $eq: ["$$original.id", "$$line.saleLineId"] },
          },
        },
        0,
      ],
    };
    refunds.push({
      $project: {
        _id: 0,
        id: 1,
        saleId: 1,
        operationId: 1, restock: 1, ingredientCostMinor:1,
        kind: { $literal: "REFUND" },
        occurredAt: "$updatedAt",
        locationId: "$sale.locationId",
        reference: "$sale.receiptReference",
        amountMinor: 1,
        currency: 1,
        lines: {
          $map: {
            input: "$lines",
            as: "line",
            in: {
              $let: {
                vars: { original: originalLine },
                in: {
                  name: "$$original.name",
                  quantity: "$$line.quantity",
                  priceMinor: "$$original.priceMinor",
                },
              },
            },
          },
        },
      },
    });
    return [
      { $match: saleMatch },
      {
        $project: {
          _id: 0,
          id: 1,
          saleId: "$id",
          operationId: 1, ingredientCostMinor:1,
          kind: { $literal: "SALE" },
          occurredAt: "$completedAt",
          locationId: 1,
          reference: "$receiptReference",
          amountMinor: "$totalMinor",
          currency: 1,
          lines: {
            $map: {
              input: "$lines",
              as: "line",
              in: {
                name: "$$line.name",
                quantity: "$$line.quantity",
                priceMinor: "$$line.priceMinor",
              },
            },
          },
        },
      },
      { $unionWith: { coll: "refunds", pipeline: refunds } },
    ];
  }
  async reportRecords(query:ReportQuery){
    return await this.db.collection('sales').aggregate([...this.reportPipeline(query),{$sort:{occurredAt:-1,id:-1,kind:-1}},{$limit:10001}]).toArray() as unknown as import('../application/ports').ReportRow[];
  }
  async report(query: ReportQuery, currency: string): Promise<SalesReport> {
    const pipeline = this.reportPipeline(query);
    const totals = await this.db
      .collection("sales")
      .aggregate([
        ...pipeline,
        {
          $group: {
            _id: null,
            currencies: {$addToSet:'$currency'},
            grossMinor: {
              $sum: { $cond: [{ $eq: ["$kind", "SALE"] }, "$amountMinor", 0] },
            },
            refundMinor: {
              $sum: {
                $cond: [{ $eq: ["$kind", "REFUND"] }, "$amountMinor", 0],
              },
            },
            completedSales: {
              $sum: { $cond: [{ $eq: ["$kind", "SALE"] }, 1, 0] },
            },
            soldItems: {
              $sum: {
                $cond: [
                  { $eq: ["$kind", "SALE"] },
                  { $sum: "$lines.quantity" },
                  0,
                ],
              },
            },
            refundedItems: {
              $sum: {
                $cond: [
                  { $eq: ["$kind", "REFUND"] },
                  { $sum: "$lines.quantity" },
                  0,
                ],
              },
            },
          },
        },
      ])
      .next();
    const after = parseCursor(query.cursor);
    if (after)
      pipeline.push({
        $match: {
          $or: [
            { occurredAt: { $lt: after.time } },
            { occurredAt: after.time, id: { $lt: after.id } },
            {
              occurredAt: after.time,
              id: after.id,
              kind: { $lt: after.kind ?? "" },
            },
          ],
        },
      });
    pipeline.push(
      { $sort: { occurredAt: -1, id: -1, kind: -1 } },
      { $limit: query.limit + 1 },
    );
    const rows = await this.db
      .collection("sales")
      .aggregate(pipeline)
      .toArray();
    const more = rows.length > query.limit;
    const items = rows.slice(0, query.limit) as unknown as SalesReport["items"];
    const last = items.at(-1);
    const grossMinor = Number(totals?.grossMinor ?? 0),
      refundMinor = Number(totals?.refundMinor ?? 0);
    if(totals?.currencies?.some((value:unknown)=>value!==currency))throw new SalesError('CURRENCY_MISMATCH','The selected report period contains records in a different currency. Restore the original currency configuration or choose a matching period.');
    if (!Number.isSafeInteger(grossMinor) || !Number.isSafeInteger(refundMinor))
      throw new SalesError(
        "INVALID_REQUEST",
        "Report monetary total exceeds safe integer precision.",
        422,
      );
    return {
      items,
      nextCursor:
        more && last
          ? cursor({ time: last.occurredAt, id: last.id, kind: last.kind })
          : null,
      from: query.from,
      to: query.to,
      locationId: query.locationId ?? null,
      currency,
      grossMinor,
      refundMinor,
      netMinor: grossMinor - refundMinor,
      completedSales: Number(totals?.completedSales ?? 0),
      soldItems: Number(totals?.soldItems ?? 0),
      refundedItems: Number(totals?.refundedItems ?? 0),
    };
  }
  async events(limit: number) {
    return (
      await this.db
        .collection("outbox")
        .find({
          publishedAt: null,
          nextAttemptAt: { $lte: new Date().toISOString() },
        })
        .sort({ createdAt: 1, eventId: 1 })
        .limit(limit)
        .toArray()
    ).map((r) => clean(r) as unknown as OutboxEvent);
  }
  async published(id: string, at: string) {
    await this.db
      .collection("outbox")
      .updateOne(
        { eventId: id, publishedAt: null },
        { $set: { publishedAt: at } },
      );
  }
  async failed(id: string, attempts: number, next: string) {
    await this.db
      .collection("outbox")
      .updateOne(
        { eventId: id, publishedAt: null },
        { $set: { attempts, nextAttemptAt: next } },
      );
  }
}
