import type { MongoClient } from 'mongodb';
import { DEFAULT_LOCATION_ID } from '../domain/operations';

/** Operator-owned migration. Stop Inventory writers before executing against an existing database. */
export async function migrateInventory(client: MongoClient): Promise<{ migrated: boolean; balances: number; movements: number }> {
  const db = client.db(), metadata = db.collection<{ _id: string; version: number; state: string }>('schema_metadata');
  const existing = await metadata.findOne({ _id: 'inventory' });
  if (existing?.version === 2 && existing.state === 'READY') return { migrated: false, balances: await db.collection('inventory').countDocuments(), movements: await db.collection('stock_movements').countDocuments() };
  if (existing && existing.version > 2) throw new Error('Inventory schema is newer than this migration.');
  const timestamp = new Date().toISOString();
  await metadata.updateOne({ _id: 'inventory' }, { $set: { version: 1, state: 'MIGRATING' } }, { upsert: true });
  const balances = db.collection<any>('inventory'), movements = db.collection<any>('stock_movements');
  // An empty database has no collections yet. Create them before listing old indexes.
  for (const name of ['inventory','stock_movements']) {
    if (!(await db.listCollections({name},{nameOnly:true}).toArray()).length) await db.createCollection(name);
  }
  for (const [source, backup] of [[balances, db.collection<any>('migration_v1_inventory')], [movements, db.collection<any>('migration_v1_movements')]] as const) {
    for await (const row of source.find()) await backup.updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true });
  }
  await db.collection<any>('locations').updateOne({ _id: DEFAULT_LOCATION_ID }, { $setOnInsert: { name: 'Main Store', normalizedName: 'main store', version: 0, createdAt: timestamp, updatedAt: timestamp } }, { upsert: true });
  await balances.updateMany({ locationId: { $exists: false } }, { $set: { locationId: DEFAULT_LOCATION_ID } });
  const commands = db.collection<any>('stock_commands');
  for await (const row of movements.find({ operationId: { $exists: false } })) {
    if (!row.idempotencyKey || !row.command || !row.result) throw new Error(`Legacy movement ${row._id} has no recoverable command result.`);
    await commands.updateOne({ _id: row.idempotencyKey }, { $setOnInsert: { origin: 'LEGACY', fingerprint: 'LEGACY', operationId: row._id, command: row.command, result: row.result, createdAt: row.createdAt } }, { upsert: true });
    await movements.updateOne({ _id: row._id }, { $set: { locationId: DEFAULT_LOCATION_ID, operationId: row._id, lineId: '0', cause: 'MANUAL' } });
  }
  // Drop only the two obsolete uniqueness constraints, after backup and replay backfill.
  const balanceIndexes = await balances.listIndexes().toArray();
  for (const index of balanceIndexes) if (index.unique && Object.keys(index.key).length === 1 && index.key.productId === 1) await balances.dropIndex(index.name!);
  const movementIndexes = await movements.listIndexes().toArray();
  for (const index of movementIndexes) if (index.unique && Object.keys(index.key).length === 1 && index.key.idempotencyKey === 1) await movements.dropIndex(index.name!);
  await balances.createIndex({ productId: 1, locationId: 1 }, { unique: true });
  await movements.createIndex({ operationId: 1, lineId: 1 }, { unique: true });
  await commands.createIndex({ operationId: 1 }, { unique: true });
  await db.collection('locations').createIndex({ normalizedName: 1 }, { unique: true });
  await metadata.updateOne({ _id: 'inventory' }, { $set: { version: 2, state: 'READY' } });
  return { migrated: true, balances: await balances.countDocuments(), movements: await movements.countDocuments() };
}

export async function assertInventorySchema(client: MongoClient): Promise<void> {
  const schema = await client.db().collection('schema_metadata').findOne({ _id: 'inventory' as any });
  if (schema?.version !== 2 || schema.state !== 'READY') throw new Error('Inventory schema v2 is required. Stop Inventory writers and run npm run migrate:inventory before starting.');
}
