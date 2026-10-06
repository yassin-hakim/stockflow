import { valueReturn } from "../domain/valuation";
import { randomUUID } from "node:crypto";
import {
  MongoServerError,
  type MongoClient,
  type ClientSession,
} from "mongodb";
import type { OperationStore } from "../application/operations";
import {
  normalizeOperation,
  returnLines,
  OperationError,
  type Balance,
  type OperationCommand,
  type OperationPlan,
  type OperationResult,
  type OperationMovement,
} from "../domain/operations";
import type {
  InventoryManagementRepository,
  SupplierRecord,
  CountRecord,
  RuleRecord,
  HistoryFilter,
} from "../application/inventory-management";
import type {
  WarehouseLocation,
  WarehouseRepository,
} from "../application/warehouse";

export class MongoOperationsStore
  implements OperationStore, WarehouseRepository, InventoryManagementRepository
{
  constructor(private readonly client: MongoClient) {}
  private get db() {
    return this.client.db();
  }
  async setup(): Promise<void> {
    await this.db
      .collection("stock_commands")
      .createIndex({ origin: 1, createdAt: -1, _id: -1 });
    await this.db
      .collection("stock_commands")
      .createIndex({
        "result.locationId": 1,
        "result.kind": 1,
        createdAt: -1,
        _id: -1,
      });
    await this.db
      .collection("stock_movements")
      .createIndex({ cause: 1, locationId: 1, createdAt: -1, _id: -1 });
    await this.db
      .collection("count_sessions")
      .createIndex({ locationId: 1, createdAt: -1, _id: -1 });
    await this.db
      .collection("replenishment_rules")
      .createIndex({ productId: 1, locationId: 1 }, { unique: true });
    await this.db
      .collection("suppliers")
      .createIndex({ normalizedName: 1 }, { unique: true });
    await this.db
      .collection("stock_movements")
      .createIndex({ locationId: 1, productId: 1, createdAt: -1, _id: -1 });
  }
  async findCommand(
    key: string,
  ): Promise<{ fingerprint: string; result: OperationResult } | null> {
    const row = await this.db
      .collection<any>("stock_commands")
      .findOne({ _id: key });
    if (row && row.origin === "COUNT_CREATE")
      throw new OperationError(
        "IDEMPOTENCY_CONFLICT",
        "This request identity belongs to a count creation.",
      );
    return row ? { fingerprint: row.fingerprint, result: row.result } : null;
  }
  async locationExists(id: string): Promise<boolean> {
    return !!(await this.db.collection<any>("locations").findOne({ _id: id }));
  }

  async supplierExists(id: string): Promise<boolean> {
    return !!(await this.db.collection<any>("suppliers").findOne({ _id: id }));
  }
  async suppliers(): Promise<SupplierRecord[]> {
    return (
      await this.db
        .collection<any>("suppliers")
        .find()
        .sort({ normalizedName: 1, _id: 1 })
        .toArray()
    ).map(({ _id, normalizedName, ...value }) => ({ id: _id, ...value }));
  }
  async supplier(id: string): Promise<SupplierRecord | null> {
    const row = await this.db.collection<any>("suppliers").findOne({ _id: id });
    if (!row) return null;
    const { _id, normalizedName, ...value } = row;
    return { id: _id, ...value };
  }
  async saveSupplier(
    value: SupplierRecord,
    expected: number | null,
  ): Promise<boolean> {
    const { id, ...fields } = value;
    try {
      if (expected === null) {
        await this.db
          .collection<any>("suppliers")
          .insertOne({
            _id: id,
            ...fields,
            normalizedName: value.name.toLowerCase(),
          });
        return true;
      }
      return (
        (
          await this.db
            .collection<any>("suppliers")
            .updateOne(
              { _id: id, version: expected },
              { $set: { ...fields, normalizedName: value.name.toLowerCase() } },
            )
        ).matchedCount === 1
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        throw new OperationError(
          "SUPPLIER_NAME_CONFLICT",
          "Supplier name already exists.",
        );
      throw error;
    }
  }
  async count(id: string): Promise<CountRecord | null> {
    const row = await this.db
      .collection<any>("count_sessions")
      .findOne({ _id: id });
    if (!row) return null;
    const { _id, creationFingerprint, ...value } = row;
    return { id: _id, ...value };
  }
  async counts(
    filter: HistoryFilter,
    cursor: string | undefined,
    limit: number,
  ) {
    const rows = await this.db
        .collection<any>("count_sessions")
        .find({
          $and: [historyQuery(filter), cursorQuery(cursor, "createdAt")],
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .toArray(),
      visible = rows.slice(0, limit);
    return {
      items: visible.map(
        ({ _id, creationFingerprint, ...value }) =>
          ({ id: _id, ...value }) as CountRecord,
      ),
      nextCursor: rows.length > limit ? encodeCursor(visible.at(-1)!) : null,
    };
  }
  async createCount(
    value: CountRecord,
    fingerprint: string,
  ): Promise<CountRecord> {
    const existing = await this.db
      .collection<any>("count_sessions")
      .findOne({ _id: value.id });
    if (existing) {
      if (existing.creationFingerprint !== fingerprint)
        throw new OperationError(
          "IDEMPOTENCY_CONFLICT",
          "This count identity belongs to different input.",
        );
      const { _id, creationFingerprint, ...fields } = existing;
      return { id: _id, ...fields };
    }
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        const { id, ...fields } = value;
        await this.db
          .collection<any>("stock_commands")
          .insertOne(
            {
              _id: id,
              operationId: id,
              origin: "COUNT_CREATE",
              fingerprint,
              createdAt: value.createdAt,
            },
            { session },
          );
        await this.db
          .collection<any>("count_sessions")
          .insertOne(
            { _id: id, ...fields, creationFingerprint: fingerprint },
            { session },
          );
      });
      return value;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const saved = await this.db
          .collection<any>("count_sessions")
          .findOne({ _id: value.id });
        if (saved && saved.creationFingerprint === fingerprint) {
          const { _id, creationFingerprint, ...fields } = saved;
          return { id: _id, ...fields };
        }
        throw new OperationError(
          "IDEMPOTENCY_CONFLICT",
          "This request identity belongs to different input.",
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
  async updateCount(value: CountRecord, expected: number): Promise<boolean> {
    const { id, ...fields } = value;
    return (
      (
        await this.db
          .collection<any>("count_sessions")
          .updateOne(
            { _id: id, status: "DRAFT", version: expected },
            { $set: fields },
          )
      ).matchedCount === 1
    );
  }
  async rules(locationId?: string): Promise<RuleRecord[]> {
    return this.db
      .collection<any>("replenishment_rules")
      .find(locationId ? { locationId } : {})
      .project({ _id: 0 })
      .sort({ locationId: 1, productId: 1 })
      .toArray() as Promise<RuleRecord[]>;
  }
  async saveRule(value: RuleRecord, expected: number | null): Promise<boolean> {
    try {
      if (expected === null) {
        await this.db.collection("replenishment_rules").insertOne({ ...value });
        return true;
      }
      return (
        (
          await this.db
            .collection("replenishment_rules")
            .updateOne(
              {
                productId: value.productId,
                locationId: value.locationId,
                version: expected,
              },
              { $set: value },
            )
        ).matchedCount === 1
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        return false;
      throw error;
    }
  }

  async locations(): Promise<WarehouseLocation[]> {
    const rows = await this.db
      .collection<any>("locations")
      .find()
      .sort({ normalizedName: 1, _id: 1 })
      .toArray();
    return rows.map(
      ({ _id, normalizedName, ...fields }) =>
        ({ id: _id, ...fields }) as WarehouseLocation,
    );
  }
  async location(id: string): Promise<WarehouseLocation | null> {
    const row = await this.db.collection<any>("locations").findOne({ _id: id });
    if (!row) return null;
    const { _id, normalizedName, ...fields } = row;
    return { id: _id, ...fields } as WarehouseLocation;
  }
  async saveLocation(
    location: WarehouseLocation,
    expectedVersion: number | null,
  ): Promise<boolean> {
    const { id, ...fields } = location,
      collection = this.db.collection<any>("locations");
    const data = { ...fields, normalizedName: location.name.toLowerCase() };
    try {
      if (expectedVersion === null) {
        await collection.insertOne({ _id: id, ...data });
        return true;
      }
      return (
        (
          await collection.updateOne(
            { _id: id, version: expectedVersion },
            { $set: data },
          )
        ).matchedCount === 1
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        throw new OperationError(
          "LOCATION_NAME_CONFLICT",
          "A location with that name already exists.",
        );
      throw error;
    }
  }
  async allBalances(locationId?: string): Promise<Balance[]> {
    return this.db
      .collection<any>("inventory")
      .find(locationId ? { locationId } : {})
      .project({ _id: 0 })
      .toArray() as Promise<Balance[]>;
  }
  async operation(id: string): Promise<OperationResult | null> {
    return (
      (
        await this.db
          .collection<any>("stock_commands")
          .findOne({ _id: id, origin: "OPERATION" })
      )?.result ?? null
    );
  }
  async operations(
    kind?: string,
    cursor?: string,
    limit = 50,
    filter: HistoryFilter = {},
  ): Promise<{ items: OperationResult[]; nextCursor: string | null }> {
    const query: Record<string, unknown> = {
      origin: "OPERATION",
      "result.status": "COMMITTED",
      ...(kind ? { "result.kind": kind } : {}),
      ...(filter.locationId
        ? {
            $or: [
              { "result.locationId": filter.locationId },
              { "result.destinationLocationId": filter.locationId },
            ],
          }
        : {}),
      ...historyQuery({ from: filter.from, to: filter.to }),
    };
    const rows = await this.db
      .collection<any>("stock_commands")
      .find({ $and: [query, cursorQuery(cursor, "createdAt")] })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();
    const visible = rows.slice(0, limit);
    return {
      items: visible.map((row) => row.result),
      nextCursor: rows.length > limit ? encodeCursor(visible.at(-1)!) : null,
    };
  }
  async movements(
    productId: string,
    locationId?: string,
    cursor?: string,
    limit = 50,
    filter: HistoryFilter = {},
  ): Promise<{ items: OperationMovement[]; nextCursor: string | null }> {
    const rows = await this.db
      .collection<any>("stock_movements")
      .find({
        $and: [
          { productId, ...historyQuery({ ...filter, locationId }) },
          cursorQuery(cursor, "createdAt"),
        ],
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();
    const visible = rows.slice(0, limit);
    return {
      items: visible.map(
        (row) =>
          ({
            id: row._id,
            lineId: row.lineId,
            eventId: "",
            productId: row.productId,
            locationId: row.locationId,
            operationId: row.operationId,
            type: row.type,
            quantityMillis: row.quantityMillis,
            resultingQuantityMillis: row.resultingQuantityMillis,
            cause: row.cause,
            reason: row.reason,
            createdAt: row.createdAt,
          }) as OperationMovement,
      ),
      nextCursor: rows.length > limit ? encodeCursor(visible.at(-1)!) : null,
    };
  }
  async report(
    filter: HistoryFilter,
    cursor: string | undefined,
    limit: number,
  ) {
    const query = historyQuery(filter);
    const rows = await this.db
        .collection<any>("stock_movements")
        .find({ $and: [query, cursorQuery(cursor, "createdAt")] })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .toArray(),
      visible = rows.slice(0, limit);
    const conditional = (
      condition: unknown,
      value: unknown = "$quantityMillis",
    ) => ({ $sum: { $cond: [condition, value, 0] } });
    const aggregates = await this.db
      .collection("stock_movements")
      .aggregate([
        { $match: query },
        {
          $group: {
            _id: "$productId",
            added: conditional({ $eq: ["$type", "ADD"] }),
            removed: conditional({ $eq: ["$type", "REMOVE"] }),
            consumed: conditional({ $eq: ["$cause", "SALE"] }),
            waste: conditional({ $eq: ["$cause", "WASTE"] }),
            transferIn: conditional({
              $and: [
                { $eq: ["$cause", "TRANSFER"] },
                { $eq: ["$type", "ADD"] },
              ],
            }),
            transferOut: conditional({
              $and: [
                { $eq: ["$cause", "TRANSFER"] },
                { $eq: ["$type", "REMOVE"] },
              ],
            }),
            count: conditional(
              { $eq: ["$cause", "COUNT"] },
              {
                $cond: [
                  { $eq: ["$type", "ADD"] },
                  "$quantityMillis",
                  { $multiply: ["$quantityMillis", -1] },
                ],
              },
            ),
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 1001 },
      ])
      .toArray();
    if (aggregates.length > 1000)
      throw new OperationError(
        "INVALID_REQUEST",
        "Narrow the report to at most 1000 products.",
      );
    return {
      items: visible.map(movementRow),
      nextCursor: rows.length > limit ? encodeCursor(visible.at(-1)!) : null,
      filters: filter,
      products: aggregates.map((row) => ({
        productId: row._id as string,
        addedQuantity: row.added / 1000,
        removedQuantity: row.removed / 1000,
        consumedQuantity: row.consumed / 1000,
        wasteQuantity: row.waste / 1000,
        transferInQuantity: row.transferIn / 1000,
        transferOutQuantity: row.transferOut / 1000,
        countVariance: row.count / 1000,
      })),
    };
  }
  async balances(
    identities: { productId: string; locationId: string }[],
  ): Promise<Balance[]> {
    if (!identities.length) return [];
    return this.db
      .collection<any>("inventory")
      .find({ $or: identities })
      .project({ _id: 0 })
      .toArray() as Promise<Balance[]>;
  }
  async commit(
    command: OperationCommand,
    fingerprint: string,
    previous: Balance[],
    plan: OperationPlan,
  ): Promise<OperationResult | null> {
    const session = this.client.startSession();
    const result: OperationResult = {
      id: command.id,
      kind: command.kind,
      status: "COMMITTED",
      currency:process.env.CURRENCY??'USD',
      createdAt: new Date().toISOString(),
      reference: command.reference,
      reason: command.reason,
      locationId: command.locationId,
      ...(command.destinationLocationId
        ? { destinationLocationId: command.destinationLocationId }
        : {}),
      movements: plan.movements,
      command,
    };
    try {
      await session.withTransaction(async () => {
        if (command.kind === "SALE_RETURN") {
          const source = await this.db
            .collection<any>("stock_commands")
            .findOne(
              {
                _id: command.originalOperationId,
                origin: "OPERATION",
                "result.status": "COMMITTED",
                "result.kind": "SALE",
              },
              { session },
            );
          if (!source)
            throw new OperationError(
              "OPERATION_NOT_FOUND",
              "Original sale consumption not found.",
            );
          const derived = normalizeOperation({
            ...command,
            lines: returnLines(source.command, command.returnedItems ?? []),
          });
          if (
            command.locationId !== source.command.locationId ||
            JSON.stringify(derived.lines) !== JSON.stringify(command.lines)
          )
            throw new OperationError(
              "INVALID_REQUEST",
              "Stock return must use the original ingredient allocation and location.",
            );
          const returned: Record<string, number> = { ...source.returnedItems };
          for (const item of command.returnedItems ?? []) {
            const allocation = source.command.allocations?.find(
              (line: any) => line.saleLineId === item.saleLineId,
            );
            const total = (returned[item.saleLineId] ?? 0) + item.quantity;
            if (!allocation || total > allocation.quantity)
              throw new OperationError(
                "REFUND_LIMIT_EXCEEDED",
                "Cumulative stock returns exceed originally consumed items.",
              );
            returned[item.saleLineId] = total;
          }
          valueReturn(plan,previous,source.result,source.returnedItems??{},returned);
          // This original-operation write serializes concurrent returns even for disjoint balances.
          await this.db
            .collection<any>("stock_commands")
            .updateOne(
              { _id: source._id },
              { $set: { returnedItems: returned }, $inc: { returnVersion: 1 } },
              { session },
            );
        }
        const items = this.db.collection<any>("inventory");
        for (const balance of plan.balances) {
          const prior = previous.find(
            (value) =>
              value.productId === balance.productId &&
              value.locationId === balance.locationId,
          );
          if (prior) {
            const update = await items.updateOne(
              {
                productId: balance.productId,
                locationId: balance.locationId,
                version: prior.version,
              },
              { $set: balance },
              { session },
            );
            if (update.matchedCount !== 1) throw new OperationRetry();
          } else
            await items.insertOne(
              { _id: randomUUID(), ...balance },
              { session },
            );
        }
        if (command.countId) {
          const count = await this.db
            .collection<any>("count_sessions")
            .updateOne(
              {
                _id: command.countId,
                status: "DRAFT",
                version: command.countVersion,
              },
              {
                $set: {
                  status: "APPLIED",
                  operationId: command.id,
                  updatedAt: result.createdAt,
                },
                $inc: { version: 1 },
              },
              { session },
            );
          if (count.matchedCount !== 1)
            throw new OperationError(
              "VERSION_CONFLICT",
              "This count has changed or was already applied.",
            );
        }
        for (const movement of plan.movements) {
          const { id, eventId, ...fields } = movement;
          await this.db
            .collection<any>("stock_movements")
            .insertOne({ _id: id, ...fields }, { session });
          const payload = {
            schemaVersion: 2,
            eventId,
            eventType: movement.type === "ADD" ? "StockAdded" : "StockRemoved",
            movementId: id,
            productId: movement.productId,
            quantity: movement.quantityMillis / 1000,
            resultingQuantity: movement.resultingQuantityMillis / 1000,
            reason: movement.reason,
            occurredAt: movement.createdAt,
            locationId: movement.locationId,
            operationId: command.id,
            cause: command.kind,
          };
          await this.db
            .collection<any>("outbox")
            .insertOne(
              {
                _id: eventId,
                subject:
                  movement.type === "ADD"
                    ? "inventory.stock.added"
                    : "inventory.stock.removed",
                payload,
                status: "PENDING",
                attempts: 0,
                nextAttemptAt: new Date(),
                createdAt: new Date(result.createdAt),
              },
              { session },
            );
        }
        const documents: Partial<Record<OperationCommand["kind"], string>> = {
          RECEIPT: "receipts",
          TRANSFER: "transfers",
          WASTE: "waste_records",
        };
        if (documents[command.kind])
          await this.db
            .collection<any>(documents[command.kind]!)
            .insertOne({ _id: command.id, ...result }, { session });
        await this.db
          .collection<any>("stock_commands")
          .insertOne(
            {
              _id: command.id,
              origin: "OPERATION",
              fingerprint,
              operationId: command.id,
              command,
              result,
              createdAt: result.createdAt,
            },
            { session },
          );
      });
      return result;
    } catch (error) {
      if (
        error instanceof OperationRetry ||
        (error instanceof MongoServerError &&
          [11000, 112, 251].includes(Number(error.code)))
      )
        return null;
      if (
        error instanceof OperationError &&
        error.code === "REFUND_LIMIT_EXCEEDED"
      )
        return this.reject(command, fingerprint, error);
      throw error;
    } finally {
      await session.endSession();
    }
  }
  async reject(
    command: OperationCommand,
    fingerprint: string,
    error: OperationError,
  ): Promise<OperationResult> {
    const result: OperationResult = {
      id: command.id,
      kind: command.kind,
      status: "REJECTED",
      currency:process.env.CURRENCY??'USD',
      createdAt: new Date().toISOString(),
      reference: command.reference,
      reason: command.reason,
      locationId: command.locationId,
      ...(command.destinationLocationId ? {destinationLocationId:command.destinationLocationId} : {}),
      movements: [],
      error: { code: error.code, message: error.message },
      command,
    };
    try {
      await this.db
        .collection<any>("stock_commands")
        .insertOne({
          _id: command.id,
          origin: "OPERATION",
          fingerprint,
          operationId: command.id,
          command,
          result,
          createdAt: result.createdAt,
        });
      return result;
    } catch (failure) {
      if (!(failure instanceof MongoServerError) || failure.code !== 11000)
        throw failure;
      const existing = await this.findCommand(command.id);
      if (!existing || existing.fingerprint !== fingerprint)
        throw new OperationError(
          "IDEMPOTENCY_CONFLICT",
          "This request identity belongs to different input.",
        );
      return existing.result;
    }
  }
}
class OperationRetry extends Error {}
function encodeCursor(row: { _id: string; createdAt: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt, row._id])).toString(
    "base64url",
  );
}
function cursorQuery(
  cursor: string | undefined,
  field: string,
): Record<string, unknown> {
  if (!cursor) return {};
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value.some((item) => typeof item !== "string") ||
      !Number.isFinite(Date.parse(value[0]))
    )
      throw new Error();
    return {
      $or: [
        { [field]: { $lt: value[0] } },
        { [field]: value[0], _id: { $lt: value[1] } },
      ],
    };
  } catch {
    throw new OperationError("INVALID_REQUEST", "Invalid page cursor.");
  }
}

function historyQuery(filter: HistoryFilter): Record<string, unknown> {
  return {
    ...(filter.locationId ? { locationId: filter.locationId } : {}),
    ...(filter.productId ? { productId: filter.productId } : {}),
    ...(filter.cause ? { cause: filter.cause } : {}),
    ...(filter.from || filter.to
      ? {
          createdAt: {
            ...(filter.from ? { $gte: filter.from } : {}),
            ...(filter.to ? { $lt: filter.to } : {}),
          },
        }
      : {}),
  };
}

function movementRow(row: any): OperationMovement {
  return {
    costMinor: row.costMinor ?? null,
    id: row._id,
    lineId: row.lineId,
    eventId: "",
    productId: row.productId,
    locationId: row.locationId,
    operationId: row.operationId,
    type: row.type,
    quantityMillis: row.quantityMillis,
    resultingQuantityMillis: row.resultingQuantityMillis,
    cause: row.cause,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}
