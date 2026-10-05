import { MongoClient } from 'mongodb';

async function main(): Promise<void> {
  const productId = process.argv[2];
  if (!productId) throw new Error('Usage: npx tsx scripts/inspect-product.ts <productId>');
  const inventory = await MongoClient.connect(process.env.INVENTORY_MONGO_URI ?? 'mongodb://localhost:27017/stockflow_inventory?replicaSet=rs0&directConnection=true');
  const audit = await MongoClient.connect(process.env.AUDIT_MONGO_URI ?? 'mongodb://localhost:27017/stockflow_audit?replicaSet=rs0&directConnection=true');
  try {
    const db = inventory.db();
    const item = await db.collection('inventory').findOne({ productId });
    const movements = await db.collection('stock_movements').countDocuments({ productId });
    const outbox = await db.collection('outbox').find({ 'payload.productId': productId }).project({ status: 1, attempts: 1 }).toArray();
    const auditCount = await audit.db().collection('stock_events').countDocuments({ 'event.productId': productId });
    process.stdout.write(JSON.stringify({ productId, quantityMillis: item?.quantityMillis ?? 0, movements, outbox, auditCount }) + '\n');
  } finally { await inventory.close(); await audit.close(); }
}
void main();
