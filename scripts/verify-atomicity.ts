import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoStockStore } from '../apps/inventory-service/src/infrastructure/mongo-stock-store';
import { changeStock, type StockCommand } from '../apps/inventory-service/src/domain/stock';
import { toPersistedChange } from '../apps/inventory-service/src/application/stock-use-cases';
import { migrateInventory } from '../apps/inventory-service/src/infrastructure/inventory-migration';

async function main(): Promise<void> {
  const mongo = await MongoClient.connect(process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017/stockflow_inventory_test?replicaSet=rs0&directConnection=true');
  try {
    await migrateInventory(mongo);
    const store = new MongoStockStore(mongo);
    await store.setup();
    const productId = randomUUID();
    const first: StockCommand = { productId, type: 'ADD', quantityMillis: 1000, reason: 'Atomicity test', idempotencyKey: randomUUID() };
    const firstChange = toPersistedChange(changeStock(null, first));
    assert.equal(await store.commit(first, null, firstChange), true);
    const before = await store.find(productId);
    assert.equal(before?.quantityMillis, 1000);
    const second: StockCommand = { ...first, idempotencyKey: randomUUID() };
    const secondChange = toPersistedChange(changeStock(before, second));
    secondChange.event.eventId = firstChange.event.eventId; // force the third write to fail on the outbox primary key
    assert.equal(await store.commit(second, before, secondChange), false);
    assert.equal((await store.find(productId))?.quantityMillis, 1000);
    assert.equal(await store.movementsCollection.countDocuments({ productId }), 1);
    assert.equal(await store.outbox.countDocuments({ 'payload.productId': productId }), 1);
    process.stdout.write(`Verified transaction rollback for ${productId}: balance, movement and outbox stayed unchanged.\n`);
  } finally { await mongo.close(); }
}
void main();
