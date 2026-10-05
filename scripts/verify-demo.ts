import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { ApiError, InventoryOverview, Product, StockChangeResult } from '@stockflow/contracts';

const bff = process.env.BFF_URL ?? 'http://localhost:3000';
const inventoryUri = process.env.INVENTORY_MONGO_URI ?? 'mongodb://localhost:27017/stockflow_inventory?replicaSet=rs0&directConnection=true';
const auditUri = process.env.AUDIT_MONGO_URI ?? 'mongodb://localhost:27017/stockflow_audit?replicaSet=rs0&directConnection=true';

async function request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${bff}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() as T };
}

async function main(): Promise<void> {
  const inventory = await MongoClient.connect(inventoryUri), audit = await MongoClient.connect(auditUri);
  try {
    const created = await request<Product>('/api/products', 'POST', { name: `Arabica Coffee ${randomUUID().slice(0, 8)}`, unit: 'kg', category: 'Coffee', lowStockThreshold: 5 });
    assert.equal(created.status, 201);
    const id = created.body.id;
    const initial = await request<InventoryOverview>(`/api/inventory/${id}`);
    assert.deepEqual([initial.body.quantity, initial.body.status], [0, 'OUT']);
    assert.equal(await inventory.db().collection('inventory').countDocuments({ productId: id }), 0);
    assert.equal(await inventory.db().collection('stock_movements').countDocuments({ productId: id }), 0);
    assert.equal(await inventory.db().collection('outbox').countDocuments({ 'payload.productId': id }), 0);
    assert.equal(await audit.db().collection('stock_events').countDocuments({ 'event.productId': id }), 0);
    const addKey = randomUUID();
    const add = await request<StockChangeResult>(`/api/inventory/${id}/add`, 'POST', { quantity: 50, reason: 'Supplier delivery' }, addKey);
    assert.equal(add.status, 200); assert.equal(add.body.quantity, 50);
    const replay = await request<StockChangeResult>(`/api/inventory/${id}/add`, 'POST', { quantity: 50, reason: 'Supplier delivery' }, addKey);
    assert.equal(replay.body.movement.id, add.body.movement.id);
    const changedReplay = await request<ApiError>(`/api/inventory/${id}/add`, 'POST', { quantity: 51, reason: 'Supplier delivery' }, addKey);
    assert.equal(changedReplay.status, 409); assert.equal(changedReplay.body.error.code, 'IDEMPOTENCY_CONFLICT');
    const remove = await request<StockChangeResult>(`/api/inventory/${id}/remove`, 'POST', { quantity: 10, reason: 'Restaurant order' }, randomUUID());
    assert.equal(remove.status, 200); assert.equal(remove.body.quantity, 40);
    const beforeMovementCount = await inventory.db().collection('stock_movements').countDocuments({ productId: id });
    const beforeOutboxCount = await inventory.db().collection('outbox').countDocuments({ 'payload.productId': id });
    const rejected = await request<ApiError>(`/api/inventory/${id}/remove`, 'POST', { quantity: 50, reason: 'Too much' }, randomUUID());
    assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'INSUFFICIENT_STOCK');
    assert.equal((await request<InventoryOverview>(`/api/inventory/${id}`)).body.quantity, 40);
    assert.equal(await inventory.db().collection('stock_movements').countDocuments({ productId: id }), beforeMovementCount);
    assert.equal(await inventory.db().collection('outbox').countDocuments({ 'payload.productId': id }), beforeOutboxCount);
    assert.equal(beforeMovementCount, 2); assert.equal(beforeOutboxCount, 2);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && await audit.db().collection('stock_events').countDocuments({ 'event.productId': id }) < 2) await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await audit.db().collection('stock_events').countDocuments({ 'event.productId': id }), 2);
    const raceProduct = await request<Product>('/api/products', 'POST', { name: `Race stock ${randomUUID().slice(0, 8)}`, unit: 'kg', category: 'Test' });
    assert.equal(raceProduct.status, 201);
    const raceId = raceProduct.body.id;
    assert.equal((await request<StockChangeResult>(`/api/inventory/${raceId}/add`, 'POST', { quantity: 40, reason: 'Initial stock' }, randomUUID())).status, 200);
    const race = await Promise.all([randomUUID(), randomUUID()].map(key => request<StockChangeResult | ApiError>(`/api/inventory/${raceId}/remove`, 'POST', { quantity: 30, reason: 'Concurrent order' }, key)));
    assert.deepEqual(race.map(response => response.status).sort(), [200, 409]);
    assert.equal((await request<InventoryOverview>(`/api/inventory/${raceId}`)).body.quantity, 10);
    assert.equal(await inventory.db().collection('stock_movements').countDocuments({ productId: raceId }), 2);
    assert.equal(await inventory.db().collection('outbox').countDocuments({ 'payload.productId': raceId }), 2);
    const firstInsertProduct = await request<Product>('/api/products', 'POST', { name: `First insert race ${randomUUID().slice(0, 8)}`, unit: 'kg', category: 'Test' });
    assert.equal(firstInsertProduct.status, 201);
    const firstInsertId = firstInsertProduct.body.id;
    const firstInsert = await Promise.all([
      { quantity: 30, key: randomUUID() },
      { quantity: 20, key: randomUUID() },
    ].map(({ quantity, key }) => request<StockChangeResult | ApiError>(`/api/inventory/${firstInsertId}/add`, 'POST', { quantity, reason: 'Concurrent first stock' }, key)));
    assert.deepEqual(firstInsert.map(response => response.status), [200, 200]);
    assert.equal((await request<InventoryOverview>(`/api/inventory/${firstInsertId}`)).body.quantity, 50);
    assert.equal(await inventory.db().collection('stock_movements').countDocuments({ productId: firstInsertId }), 2);
    assert.equal(await inventory.db().collection('outbox').countDocuments({ 'payload.productId': firstInsertId }), 2);
    const firstInsertDeadline = Date.now() + 15000;
    while (Date.now() < firstInsertDeadline && await audit.db().collection('stock_events').countDocuments({ 'event.productId': firstInsertId }) < 2) await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await audit.db().collection('stock_events').countDocuments({ 'event.productId': firstInsertId }), 2);
    process.stdout.write(`Verified product ${id}: 0 → 50 → 40; rejected 50; 2 movements, 2 outbox events, 2 audit records.\n`);
    process.stdout.write(`Verified concurrent removal on ${raceId}: one 200, one 409, final 10.\n`);
    process.stdout.write(`Verified concurrent first additions on ${firstInsertId}: 30 + 20, final 50, 2 movements and 2 audit records.\n`);
  } finally { await inventory.close(); await audit.close(); }
}
void main();
