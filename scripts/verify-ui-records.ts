import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';

const productId = process.argv[2];
if (!productId || !/^[0-9a-f-]{36}$/i.test(productId)) throw new Error('Usage: npm run verify:ui-records -- <product UUID>');
const mongo = process.env.MONGO_ADMIN_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';

async function main(): Promise<void> {
  const client = await MongoClient.connect(mongo);
  try {
    const product = await client.db('stockflow_product').collection('products').findOne({ _id: productId });
    const inventory = await client.db('stockflow_inventory').collection('inventory').findOne({ productId });
    const movements = await client.db('stockflow_inventory').collection('stock_movements').find({ productId }).sort({ createdAt: 1 }).toArray();
    const outbox = await client.db('stockflow_inventory').collection('outbox').find({ 'payload.productId': productId }).sort({ createdAt: 1 }).toArray();
    const audit = await client.db('stockflow_audit').collection('stock_events').find({ 'event.productId': productId }).toArray();
    assert.equal(product?.unit, 'kg');
    assert.equal(product?.lowStockThresholdMillis, 5000);
    assert.equal(inventory?.quantityMillis, 40000);
    assert.deepEqual(movements.map(row => [row.type, row.quantityMillis, row.resultingQuantityMillis]), [['ADD', 50000, 50000], ['REMOVE', 10000, 40000]]);
    assert.equal(outbox.length, 2);
    assert(outbox.every(row => row.status === 'PUBLISHED' && row.publishedAt instanceof Date));
    assert.equal(audit.length, 2);
    assert.deepEqual(new Set(outbox.map(row => row._id)), new Set(audit.map(row => row._id)));
    assert.deepEqual(new Set(outbox.map(row => row.payload.movementId)), new Set(movements.map(row => row._id)));
    process.stdout.write(`Verified UI product ${productId}: 40 kg, two movements, two published outbox events and matching audit rows.\n`);
  } finally { await client.close(); }
}
void main();
