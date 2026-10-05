import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ApiError, InventoryOverview, Items, Product, StockChangeResult, StockMovement } from '@stockflow/contracts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function call<T>(url: string, body?: unknown, key?: string) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}), 'X-Request-ID': 'untrusted-client-id' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, header: response.headers.get('x-request-id'), body: await response.json() as T };
}
function error(result: Awaited<ReturnType<typeof call<ApiError>>>, status: number, code: string): void {
  assert.equal(result.status, status); assert.equal(result.body.error.code, code); assert.match(result.header ?? '', uuid); assert.equal(result.body.error.requestId, result.header);
}
async function main(): Promise<void> {
  const root = 'http://localhost:3000';
  const name = `API Coffee ${randomUUID().slice(0, 8)}`;
  error(await call<ApiError>(`${root}/api/products`, { name, unit: 'kg', category: 'Coffee', extra: true }), 400, 'INVALID_REQUEST');
  error(await call<ApiError>(`${root}/api/products`, { name, unit: 'kg', category: 'Coffee', lowStockThreshold: 1.0001 }), 400, 'INVALID_REQUEST');
  const created = await call<Product>(`${root}/api/products`, { name, unit: 'kg', category: 'Coffee', lowStockThreshold: 5 });
  assert.equal(created.status, 201); assert.match(created.body.id, uuid); assert.equal(created.body.lowStockThreshold, 5);
  const id = created.body.id;
  assert.equal((await call<Product>(`${root}/api/products/${id}`)).body.id, id);
  assert((await call<Items<Product>>(`${root}/api/products`)).body.items.some(product => product.id === id));
  const initial = await call<InventoryOverview>(`${root}/api/inventory/${id}`);
  assert.deepEqual([initial.body.quantity, initial.body.status], [0, 'OUT']);
  const internalMissing = await fetch(`http://localhost:3002/inventory/${id}`);
  assert.equal(internalMissing.status, 404);
  assert.equal(((await internalMissing.json()) as ApiError).error.code, 'INVENTORY_NOT_FOUND');
  error(await call<ApiError>(`${root}/api/inventory/${id}/remove`, { quantity: 1, reason: 'Initial removal' }, randomUUID()), 409, 'INSUFFICIENT_STOCK');
  error(await call<ApiError>(`${root}/api/inventory/${randomUUID()}/add`, { quantity: 1, reason: 'Unknown product' }, randomUUID()), 404, 'PRODUCT_NOT_FOUND');
  error(await call<ApiError>(`${root}/api/products/${randomUUID()}`), 404, 'PRODUCT_NOT_FOUND');
  error(await call<ApiError>(`${root}/api/inventory/${id}/add`, { quantity: 0, reason: 'Invalid' }, randomUUID()), 422, 'INVALID_QUANTITY');
  error(await call<ApiError>(`${root}/api/inventory/${id}/add`, { quantity: 1.0001, reason: 'Invalid' }, randomUUID()), 422, 'INVALID_QUANTITY');
  error(await call<ApiError>(`${root}/api/inventory/${id}/add`, { quantity: 1, reason: '' }, randomUUID()), 400, 'INVALID_REQUEST');
  error(await call<ApiError>(`${root}/api/inventory/${id}/add`, { quantity: 1, reason: 'Missing key' }), 400, 'INVALID_REQUEST');
  const key = randomUUID();
  const add = await call<StockChangeResult>(`${root}/api/inventory/${id}/add`, { quantity: 4, reason: '  Delivery  ' }, key);
  assert.equal(add.status, 200); assert.equal(add.body.quantity, 4); assert.equal(add.body.movement.reason, 'Delivery');
  assert.equal((await call<InventoryOverview>(`${root}/api/inventory/${id}`)).body.status, 'LOW');
  const replay = await call<StockChangeResult>(`${root}/api/inventory/${id}/add`, { quantity: 4, reason: 'Delivery' }, key);
  assert.equal(replay.body.movement.id, add.body.movement.id);
  error(await call<ApiError>(`${root}/api/inventory/${id}/add`, { quantity: 5, reason: 'Delivery' }, key), 409, 'IDEMPOTENCY_CONFLICT');
  const second = await call<StockChangeResult>(`${root}/api/inventory/${id}/add`, { quantity: 2, reason: 'More stock' }, randomUUID());
  assert.equal(second.body.quantity, 6);
  assert.equal((await call<InventoryOverview>(`${root}/api/inventory/${id}`)).body.status, 'OK');
  const remove = await call<StockChangeResult>(`${root}/api/inventory/${id}/remove`, { quantity: 6, reason: 'Used' }, randomUUID());
  assert.equal(remove.body.quantity, 0);
  assert.equal((await call<InventoryOverview>(`${root}/api/inventory/${id}`)).body.status, 'OUT');
  const history = await call<Items<StockMovement>>(`${root}/api/inventory/${id}/movements`);
  assert.equal(history.body.items.length, 3); assert.equal(history.body.items[0].type, 'REMOVE');
  assert((await call<Items<InventoryOverview>>(`${root}/api/inventory`)).body.items.some(row => row.product.id === id && row.quantity === 0));
  process.stdout.write(`Verified public and internal API contracts for product ${id}.\n`);
}
void main();
