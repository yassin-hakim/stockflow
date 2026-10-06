import { stockChangeDto, stockMovementDto } from "../application/stock-dto";
import { MongoClient, MongoServerError, type Collection } from "mongodb";
import type {
  InventoryRecord,
  Items,
  StockChangeResult,
  StockEventV1,
  StockMovement,
} from "@stockflow/contracts";
import type {
  StockStore,
  PersistedStockChange,
} from "../application/stock-use-cases";
import type {
  OutboxRepository,
  PendingEvent,
} from "../application/publish-pending-events";
import type { InventoryItemState, StockCommand } from "../domain/stock";
import { DEFAULT_LOCATION_ID } from '../domain/operations';
import { assertInventorySchema } from './inventory-migration';

interface ItemDoc extends InventoryItemState {
  _id: string;
  locationId: string;
}
interface MovementDoc {
  _id: string;
  productId: string;
  type: "ADD" | "REMOVE";
  quantityMillis: number;
  reason: string;
  resultingQuantityMillis: number;
  idempotencyKey: string;
  command: StockCommand;
  result: StockChangeResult;
  createdAt: string;
  locationId: string;
  operationId: string;
  lineId: string;
  cause: string;
}
export interface OutboxDoc {
  _id: string;
  subject: string;
  payload: StockEventV1;
  status: "PENDING" | "PUBLISHED";
  attempts: number;
  nextAttemptAt: Date;
  createdAt: Date;
  publishedAt?: Date;
}

export class MongoStockStore implements StockStore, OutboxRepository {
  readonly items: Collection<ItemDoc>;
  readonly movementsCollection: Collection<MovementDoc>;
  readonly outbox: Collection<OutboxDoc>;
  constructor(private readonly client: MongoClient) {
    const db = client.db();
    this.items = db.collection<ItemDoc>("inventory");
    this.movementsCollection = db.collection<MovementDoc>("stock_movements");
    this.outbox = db.collection<OutboxDoc>("outbox");
  }
  async setup(): Promise<void> {
    await assertInventorySchema(this.client);
    await this.items.createIndex({ productId: 1, locationId: 1 }, { unique: true });
    await this.movementsCollection.createIndex({ operationId: 1, lineId: 1 }, { unique: true });
    await this.movementsCollection.createIndex({
      productId: 1,
      createdAt: -1,
      _id: -1,
    });
    await this.outbox.createIndex({ status: 1, nextAttemptAt: 1 });
  }
  async find(productId: string): Promise<InventoryItemState | null> {
    const doc = await this.items.findOne({ productId, locationId: DEFAULT_LOCATION_ID });
    if (!doc) return null;
    const { _id: _unused, locationId: _location, ...item } = doc;
    return item;
  }
  async findCommand(
    key: string,
  ): Promise<{ command: StockCommand; result: StockChangeResult } | null> {
    const doc = await this.client.db().collection<any>('stock_commands').findOne({ _id: key });
    return doc ? { command: doc.command, result: doc.result } : null;
  }
  async commit(
    command: StockCommand,
    before: InventoryItemState | null,
    change: PersistedStockChange,
  ): Promise<boolean> {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        if (before) {
          const update = await this.items.updateOne(
            { productId: command.productId, locationId: DEFAULT_LOCATION_ID, version: before.version },
            {
              $set: {
                quantityMillis: change.item.quantityMillis,
                valueMinor: change.item.quantityMillis===0?0:change.item.valueMinor??null,
                version: change.item.version,
                updatedAt: change.item.updatedAt,
              },
            },
            { session },
          );
          if (update.matchedCount !== 1) throw new RetryStockWrite();
        } else {
          await this.items.insertOne(
            { _id: command.productId, ...change.item, locationId: DEFAULT_LOCATION_ID },
            { session },
          );
        }
        const result = stockChangeDto(change);
        await this.movementsCollection.insertOne(
          {
            _id: change.movement.id,
            productId: command.productId,
            type: command.type,
            quantityMillis: change.movement.quantityMillis,
            reason: change.movement.reason,
            resultingQuantityMillis: change.item.quantityMillis,
            idempotencyKey: command.idempotencyKey,
            command,
            result,
            createdAt: change.movement.createdAt,
            locationId: DEFAULT_LOCATION_ID,
            operationId: change.movement.id,
            lineId: '0',
            cause: 'MANUAL',
          },
          { session },
        );
        await this.outbox.insertOne(
          {
            _id: change.event.eventId,
            subject: change.subject,
            payload: change.event,
            status: "PENDING",
            attempts: 0,
            nextAttemptAt: new Date(),
            createdAt: new Date(change.event.occurredAt),
          },
          { session },
        );
        await this.client.db().collection<any>('stock_commands').insertOne({ _id: command.idempotencyKey, origin: 'LEGACY', fingerprint: 'LEGACY', operationId: change.movement.id, command, result, createdAt: change.movement.createdAt }, { session });
      });
      return true;
    } catch (error) {
      if (
        error instanceof RetryStockWrite ||
        (error instanceof MongoServerError &&
          [11000, 112, 251].includes(Number(error.code ?? 0)))
      )
        return false;
      throw error;
    } finally {
      await session.endSession();
    }
  }
  async list(): Promise<Items<InventoryRecord>> {
    const docs = await this.items.find({ locationId: DEFAULT_LOCATION_ID }).toArray();
    return {
      items: docs.map((doc) => ({
        productId: doc.productId,
        quantity: doc.quantityMillis / 1000,
      })),
    };
  }
  async movements(productId: string): Promise<Items<StockMovement>> {
    const docs = await this.movementsCollection
      .find({ productId, locationId: DEFAULT_LOCATION_ID })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    return {
      items: docs.map((doc) => stockMovementDto({ ...doc, id: doc._id })),
    };
  }
  async findDue(limit: number): Promise<PendingEvent[]> {
    const rows = await this.outbox
      .find({ status: "PENDING", nextAttemptAt: { $lte: new Date() } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
    return rows.map((row) => ({
      eventId: row._id,
      subject: row.subject as PendingEvent["subject"],
      payload: row.payload,
      attempts: row.attempts,
    }));
  }
  async markPublished(eventId: string): Promise<void> {
    await this.outbox.updateOne(
      { _id: eventId, status: "PENDING" },
      { $set: { status: "PUBLISHED", publishedAt: new Date() } },
    );
  }
  async markFailed(eventId: string, nextAttemptAt: Date): Promise<void> {
    await this.outbox.updateOne(
      { _id: eventId, status: "PENDING" },
      { $inc: { attempts: 1 }, $set: { nextAttemptAt } },
    );
  }
}
class RetryStockWrite extends Error {}
