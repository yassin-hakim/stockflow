import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { migrateInventory } from '../apps/inventory-service/src/infrastructure/inventory-migration';
import { DEFAULT_LOCATION_ID } from '../apps/inventory-service/src/domain/operations';
import { changeStock } from '../apps/inventory-service/src/domain/stock';
import { toPersistedChange, StockUseCases } from '../apps/inventory-service/src/application/stock-use-cases';
import { MongoStockStore } from '../apps/inventory-service/src/infrastructure/mongo-stock-store';

async function main(): Promise<void> {
  const database = `stockflow_migration_test_${randomUUID().replaceAll('-','')}`;
  const client = await MongoClient.connect(`mongodb://localhost:27017/${database}?replicaSet=rs0&directConnection=true`);
  try {
    const db = client.db(), productId = randomUUID(), key = randomUUID();
    const command = { productId, type: 'ADD' as const, quantityMillis: 40000, reason: 'Legacy fixture', idempotencyKey: key };
    const change = changeStock(null, command), persisted = toPersistedChange(change);
    const result = { productId, quantity: 40, movement: { id: change.movement.id, productId, type: 'ADD', quantity: 40, reason: command.reason, createdAt: change.movement.createdAt } };
    await db.collection<any>('inventory').insertOne({ _id: productId, ...change.item });
    await db.collection<any>('inventory').createIndex({ productId: 1 }, { unique: true });
    await db.collection<any>('stock_movements').insertOne({ _id: change.movement.id, ...change.movement, resultingQuantityMillis: 40000, idempotencyKey: key, command, result });
    await db.collection<any>('stock_movements').createIndex({ idempotencyKey: 1 }, { unique: true });
    await db.collection<any>('outbox').insertOne({ _id: persisted.event.eventId, subject: persisted.subject, payload: persisted.event, status: 'PENDING' });
    const first = await migrateInventory(client);
    assert.equal(first.migrated, true);
    const migrated = await db.collection<any>('inventory').findOne({ _id: productId });
    assert.equal(migrated!.locationId, DEFAULT_LOCATION_ID);
    assert.equal(migrated!.quantityMillis, 40000);
    assert.equal(migrated!.createdAt, change.item.createdAt);
    assert.deepEqual((await db.collection<any>('outbox').findOne({ _id: persisted.event.eventId }))!.payload, persisted.event);
    const store = new MongoStockStore(client); await store.setup();
    assert.deepEqual(await new StockUseCases(store, { exists: async () => { throw new Error('Replay must not refetch catalog.'); } }).change(command), result);
    assert.equal((await migrateInventory(client)).migrated, false);
    assert.equal(await db.collection('stock_commands').countDocuments(), 1);
    assert.equal(await db.collection('stock_movements').countDocuments(), 1);
    assert.equal(await db.collection('migration_v1_inventory').countDocuments(), 1);
    process.stdout.write(`Verified migration backup, quantities/IDs/timestamps, unchanged pending v1 event, original command replay and rerun in ${database}.\n`);
  } finally { await client.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
