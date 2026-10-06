const { MongoClient } = require('mongodb');

const DEFAULT_LOCATION_ID = '00000000-0000-4000-8000-000000000001';

async function migrateInventory(client) {
  const db = client.db();
  const metadata = db.collection('schema_metadata');
  const existing = await metadata.findOne({ _id: 'inventory' });
  if (existing?.version === 2 && existing.state === 'READY') {
    return {
      migrated: false,
      balances: await db.collection('inventory').countDocuments(),
      movements: await db.collection('stock_movements').countDocuments(),
    };
  }
  if (existing && existing.version > 2) throw new Error('Inventory schema is newer than this migration.');
  const timestamp = new Date().toISOString();
  await metadata.updateOne({ _id: 'inventory' }, { $set: { version: 1, state: 'MIGRATING' } }, { upsert: true });
  const balances = db.collection('inventory');
  const movements = db.collection('stock_movements');
  for (const name of ['inventory', 'stock_movements']) {
    if (!(await db.listCollections({ name }, { nameOnly: true }).toArray()).length) await db.createCollection(name);
  }
  for (const [source, backup] of [[balances, db.collection('migration_v1_inventory')], [movements, db.collection('migration_v1_movements')]]) {
    for await (const row of source.find()) await backup.updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true });
  }
  await db.collection('locations').updateOne(
    { _id: DEFAULT_LOCATION_ID },
    { $setOnInsert: { name: 'Main Store', normalizedName: 'main store', version: 0, createdAt: timestamp, updatedAt: timestamp } },
    { upsert: true },
  );
  await balances.updateMany({ locationId: { $exists: false } }, { $set: { locationId: DEFAULT_LOCATION_ID } });
  const commands = db.collection('stock_commands');
  for await (const row of movements.find({ operationId: { $exists: false } })) {
    if (!row.idempotencyKey || !row.command || !row.result) throw new Error(`Legacy movement ${row._id} has no recoverable command result.`);
    await commands.updateOne(
      { _id: row.idempotencyKey },
      { $setOnInsert: { origin: 'LEGACY', fingerprint: 'LEGACY', operationId: row._id, command: row.command, result: row.result, createdAt: row.createdAt } },
      { upsert: true },
    );
    await movements.updateOne({ _id: row._id }, { $set: { locationId: DEFAULT_LOCATION_ID, operationId: row._id, lineId: '0', cause: 'MANUAL' } });
  }
  for (const index of await balances.listIndexes().toArray()) {
    if (index.unique && Object.keys(index.key).length === 1 && index.key.productId === 1) await balances.dropIndex(index.name);
  }
  for (const index of await movements.listIndexes().toArray()) {
    if (index.unique && Object.keys(index.key).length === 1 && index.key.idempotencyKey === 1) await movements.dropIndex(index.name);
  }
  await balances.createIndex({ productId: 1, locationId: 1 }, { unique: true });
  await movements.createIndex({ operationId: 1, lineId: 1 }, { unique: true });
  await commands.createIndex({ operationId: 1 }, { unique: true });
  await db.collection('locations').createIndex({ normalizedName: 1 }, { unique: true });
  await metadata.updateOne({ _id: 'inventory' }, { $set: { version: 2, state: 'READY' } });
  return { migrated: true, balances: await balances.countDocuments(), movements: await movements.countDocuments() };
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27117/stockflow_inventory?replicaSet=rs0&directConnection=true');
  try { process.stdout.write(`${JSON.stringify(await migrateInventory(client))}\n`); }
  finally { await client.close(); }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
