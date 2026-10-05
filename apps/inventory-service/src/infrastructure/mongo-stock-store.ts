import { MongoClient, MongoServerError, type Collection } from 'mongodb';
import type { InventoryRecord, Items, StockChangeResult, StockEventV1, StockMovement } from '@stockflow/contracts';
import type { StockStore, PersistedStockChange } from '../application/stock-use-cases';
import type { OutboxRepository, PendingEvent } from '../application/publish-pending-events';
import type { InventoryItemState, StockCommand } from '../domain/stock';

interface ItemDoc extends InventoryItemState { _id: string }
interface MovementDoc { _id: string; productId: string; type: 'ADD' | 'REMOVE'; quantityMillis: number; reason: string; resultingQuantityMillis: number; idempotencyKey: string; command: StockCommand; result: StockChangeResult; createdAt: string }
export interface OutboxDoc { _id: string; subject: string; payload: StockEventV1; status: 'PENDING' | 'PUBLISHED'; attempts: number; nextAttemptAt: Date; createdAt: Date; publishedAt?: Date }

export class MongoStockStore implements StockStore, OutboxRepository {
  readonly items: Collection<ItemDoc>;
  readonly movementsCollection: Collection<MovementDoc>;
  readonly outbox: Collection<OutboxDoc>;
  constructor(private readonly client: MongoClient) {
    const db = client.db();
    this.items = db.collection<ItemDoc>('inventory');
    this.movementsCollection = db.collection<MovementDoc>('stock_movements');
    this.outbox = db.collection<OutboxDoc>('outbox');
  }
  async setup(): Promise<void> {
    await this.items.createIndex({ productId: 1 }, { unique: true });
    await this.movementsCollection.createIndex({ idempotencyKey: 1 }, { unique: true });
    await this.movementsCollection.createIndex({ productId: 1, createdAt: -1, _id: -1 });
    await this.outbox.createIndex({ status: 1, nextAttemptAt: 1 });
  }
  async find(productId: string): Promise<InventoryItemState | null> {
    const doc = await this.items.findOne({ productId });
    if (!doc) return null;
    const { _id: _unused, ...item } = doc;
    return item;
  }
  async findCommand(key: string): Promise<{ command: StockCommand; result: StockChangeResult } | null> {
    const doc = await this.movementsCollection.findOne({ idempotencyKey: key });
    return doc ? { command: doc.command, result: doc.result } : null;
  }
  async commit(command: StockCommand, before: InventoryItemState | null, change: PersistedStockChange): Promise<boolean> {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        if (before) {
          const update = await this.items.updateOne({ productId: command.productId, version: before.version }, { $set: { quantityMillis: change.item.quantityMillis, version: change.item.version, updatedAt: change.item.updatedAt } }, { session });
          if (update.matchedCount !== 1) throw new RetryStockWrite();
        } else {
          await this.items.insertOne({ _id: command.productId, ...change.item }, { session });
        }
        const result: StockChangeResult = { productId: command.productId, quantity: change.item.quantityMillis / 1000, movement: { id: change.movement.id, productId: command.productId, type: command.type, quantity: change.movement.quantityMillis / 1000, reason: change.movement.reason, createdAt: change.movement.createdAt } };
        await this.movementsCollection.insertOne({ _id: change.movement.id, productId: command.productId, type: command.type, quantityMillis: change.movement.quantityMillis, reason: change.movement.reason, resultingQuantityMillis: change.item.quantityMillis, idempotencyKey: command.idempotencyKey, command, result, createdAt: change.movement.createdAt }, { session });
        await this.outbox.insertOne({ _id: change.event.eventId, subject: change.subject, payload: change.event, status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), createdAt: new Date(change.event.occurredAt) }, { session });
      });
      return true;
    } catch (error) {
      if (error instanceof RetryStockWrite || error instanceof MongoServerError && [11000, 112, 251].includes(Number(error.code ?? 0))) return false;
      throw error;
    } finally { await session.endSession(); }
  }
  async list(): Promise<Items<InventoryRecord>> {
    const docs = await this.items.find().toArray();
    return { items: docs.map(doc => ({ productId: doc.productId, quantity: doc.quantityMillis / 1000 })) };
  }
  async movements(productId: string): Promise<Items<StockMovement>> {
    const docs = await this.movementsCollection.find({ productId }).sort({ createdAt: -1, _id: -1 }).toArray();
    return { items: docs.map(doc => ({ id: doc._id, productId: doc.productId, type: doc.type, quantity: doc.quantityMillis / 1000, reason: doc.reason, createdAt: doc.createdAt })) };
  }
  async findDue(limit: number): Promise<PendingEvent[]> {
    const rows = await this.outbox.find({ status: 'PENDING', nextAttemptAt: { $lte: new Date() } }).sort({ createdAt: 1 }).limit(limit).toArray();
    return rows.map(row => ({ eventId: row._id, subject: row.subject as PendingEvent['subject'], payload: row.payload, attempts: row.attempts }));
  }
  async markPublished(eventId: string): Promise<void> {
    await this.outbox.updateOne({ _id: eventId, status: 'PENDING' }, { $set: { status: 'PUBLISHED', publishedAt: new Date() } });
  }
  async markFailed(eventId: string, nextAttemptAt: Date): Promise<void> {
    await this.outbox.updateOne({ _id: eventId, status: 'PENDING' }, { $inc: { attempts: 1 }, $set: { nextAttemptAt } });
  }
}
class RetryStockWrite extends Error {}
