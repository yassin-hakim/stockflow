import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Location, MenuItem, Product, Sale, StockOperation } from '@stockflow/contracts';

const base = process.env.BFF_URL ?? 'http://localhost:3000/api';
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function call<T>(path: string, init: RequestInit = {}, expected = 200): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  }, 201);
  const text = await response.text();
  const value = text ? JSON.parse(text) : undefined;
  assert.equal(response.status, expected, `${init.method ?? 'GET'} ${path}: ${text}`);
  return value as T;
}

async function csv(path: string): Promise<string> {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  assert.equal(response.status, 200, `${path}: ${text}`);
  return text;
}

async function main() {
  for (const port of [3000, 3001, 3002, 3003]) {
    const response = await fetch(`http://localhost:${port}/health/live`);
    assert.equal(response.status, 200, `service ${port} is unavailable`);
  }
  const suffix = randomUUID().slice(0, 8);
  const productName = '=CSV "Coffee"';
  const locationName = `+CSV Outlet ${suffix}`;
  const reason = ' @CSV reason';
  const menuName = '-CSV "Latte"';
  const product = await call<Product>('/products', {
    method: 'POST',
    body: JSON.stringify({ name: productName, unit: 'kg', category: `CSV ${suffix}`, lowStockThreshold: 0 }),
  }, 201);
  const location = await call<Location>('/locations', {
    method: 'POST',
    body: JSON.stringify({ name: locationName }),
  }, 201);
  const receiptKey = randomUUID();
  const receipt = await call<StockOperation>('/receipts', {
    method: 'POST',
    headers: { 'Idempotency-Key': receiptKey },
    body: JSON.stringify({
      locationId: location.id,
      reference: '-CSV "delivery"',
      reason,
      lines: [{ productId: product.id, quantity: 2, unitCostMinor: 100 }],
    }),
  });
  assert.equal(receipt.status, 'COMMITTED');
  const menu = await call<MenuItem>('/menu-items', {
    method: 'POST',
    body: JSON.stringify({ name: menuName, category: `CSV ${suffix}`, priceMinor: 500, currency: 'USD', ingredients: [{ productId: product.id, quantity: 0.1 }] }),
  }, 201);
  const sale = await call<Sale>('/sales', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ locationId: location.id, lines: [{ menuItemId: menu.id, quantity: 1 }] }),
  });
  let completed = await call<Sale>(`/sales/${sale.id}/checkout`, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ expectedVersion: sale.version, tender: 'CASH' }),
  });
  for (let attempt = 0; attempt < 40 && completed.status !== 'COMPLETED'; attempt++) {
    completed = await call<Sale>(`/sales/${sale.id}`);
    if (completed.status !== 'COMPLETED') await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(completed.status, 'COMPLETED');
  const from = new Date(Date.now() - 60_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const query = `?locationId=${encodeURIComponent(location.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const inventory = await csv(`/reports/inventory/export${query}`);
  const sales = await csv(`/reports/sales/export${query}`);
  const profitLoss = await csv(`/reports/profit-loss/export${query}`);
  for (const [name, text] of [['inventory', inventory], ['sales', sales], ['profit-loss', profitLoss]]) {
    assert.doesNotMatch(text, uuid, `${name} export leaked a raw UUID`);
    assert.match(text, /'\+CSV Outlet/);
    assert.match(text, /''|\"\"/);
  }
  assert.match(inventory, /'=CSV /);
  assert.match(inventory, /'@CSV reason/);
  assert.match(sales, /-CSV ""Latte""/);
  assert.match(profitLoss, /Gross profit/);
  const evidence = {
    passed: true,
    location: locationName,
    product: productName,
    menu: menuName,
    exports: ['inventory', 'sales', 'profit-loss'],
    receiptId: receipt.id,
    saleId: completed.id,
    rawUuidFree: true,
    formulaSafe: true,
  };
  mkdirSync('output/verification', { recursive: true });
  writeFileSync('output/verification/report-exports.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
