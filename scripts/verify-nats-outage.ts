import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { ApiError, Product, StockChangeResult } from '@stockflow/contracts';

const mode = process.argv[2];
const productId = process.argv[3];
const bff = process.env.BFF_URL ?? 'http://localhost:3000';
const mongoUri = process.env.INVENTORY_MONGO_URI ?? 'mongodb://localhost:27017/stockflow_inventory?replicaSet=rs0&directConnection=true';

async function request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${bff}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() as T };
}

async function main(): Promise<void> {
  if (mode === 'prepare') {
    const created = await request<Product>('/api/products', 'POST', {
      name: `NATS outage ${randomUUID().slice(0, 8)}`,
      unit: 'pcs',
      category: 'Verification',
    });
    assert.equal(created.status, 201);
    process.stdout.write(`Prepared product ${created.body.id}. Stop NATS, then run offline ${created.body.id}.\n`);
    return;
  }

  assert(['offline', 'recover'].includes(mode ?? ''), 'Usage: prepare | offline <productId> | recover <productId>');
  assert(productId && /^[0-9a-f-]{36}$/i.test(productId), 'Pass the Product ID printed by prepare.');
  const client = await MongoClient.connect(mongoUri);
  try {
    const db = client.db();
    const inventory = db.collection('inventory');
    const movements = db.collection('stock_movements');
    const outbox = db.collection('outbox');
    const audit = client.db('stockflow_audit').collection('stock_events');

    if (mode === 'offline') {
      assert.equal(await inventory.countDocuments({ productId }), 0, 'The verification Product must not have an Inventory row yet.');
      const added = await request<StockChangeResult | ApiError>(`/api/inventory/${productId}/add`, 'POST', {
        quantity: 1,
        reason: 'NATS outage recovery verification',
      }, randomUUID());
      assert.equal(added.status, 200, JSON.stringify(added.body));
      const deadline = Date.now() + 10000;
      let event = await outbox.findOne({ 'payload.productId': productId });
      while (!event && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        event = await outbox.findOne({ 'payload.productId': productId });
      }
      assert(event, 'Stock must commit its outbox event while NATS is offline.');
      assert.equal(event.status, 'PENDING', 'The event must remain pending while NATS is offline.');
      assert.equal(event.payload.eventType, 'StockAdded');
      assert.equal(await movements.countDocuments({ productId }), 1);
      assert.equal(await inventory.countDocuments({ productId, quantityMillis: 1000 }), 1);
      process.stdout.write(`Verified stock committed while NATS was offline: product ${productId}, pending event ${event._id}. Restart NATS, then run recover ${productId}.\n`);
      return;
    }

    const deadline = Date.now() + 30000;
    let event = await outbox.findOne({ 'payload.productId': productId });
    let audited = await audit.findOne({ 'event.productId': productId });
    while (Date.now() < deadline && (!event?.publishedAt || !audited)) {
      await new Promise(resolve => setTimeout(resolve, 200));
      event = await outbox.findOne({ 'payload.productId': productId });
      audited = await audit.findOne({ 'event.productId': productId });
    }
    assert(event, 'The committed outbox event must remain present.');
    assert(event.publishedAt instanceof Date, 'The outbox event must be marked published after JetStream PubAck.');
    assert(audited, 'The audit worker must persist the recovered JetStream event.');
    assert.equal(await outbox.countDocuments({ 'payload.productId': productId }), 1);
    assert.equal(await movements.countDocuments({ productId }), 1);
    assert.equal(await inventory.countDocuments({ productId, quantityMillis: 1000 }), 1);
    assert.equal(await audit.countDocuments({ 'event.productId': productId }), 1);
    assert.equal(audited._id, event._id);
    process.stdout.write(`Verified NATS recovery for product ${productId}: one published event and one matching audit row.\n`);
  } finally {
    await client.close();
  }
}

void main();
