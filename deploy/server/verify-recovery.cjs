const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { MongoClient } = require('mongodb');
const { connect } = require('@nats-io/transport-node');
const { jetstreamManager } = require('@nats-io/jetstream');

const base = process.env.BFF_URL || 'http://52.1.135.53';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const systemctl = (...args) => execFileSync('systemctl', args, { stdio: 'inherit' });
async function waitFor(check, description) {
  const deadline = Date.now() + 45000;
  let failure;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { failure = error; }
    await delay(300);
  }
  throw new Error(`Timed out: ${description}. ${failure?.message || ''}`);
}
async function request(path, body, key) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert(response.ok, `HTTP ${response.status}: ${path}`);
  return response.json();
}
async function main() {
  const mongo = await MongoClient.connect('mongodb://127.0.0.1:27117/?replicaSet=rs0&directConnection=true');
  const inventory = mongo.db('stockflow_inventory');
  const audits = mongo.db('stockflow_audit').collection('stock_events');
  const report = { checkedAt: new Date().toISOString(), checks: [], products: [] };
  try {
    const previous = (await request('/api/inventory')).items.map(row => ({ id: row.product.id, quantity: row.quantity }));
    const product = await request('/api/products', { name: `Recovery check ${randomUUID().slice(0, 8)}`, unit: 'pcs', category: 'Verification' });
    report.products.push(product.id);
    systemctl('stop', 'stockflow-nats');
    const changed = await request(`/api/inventory/${product.id}/add`, { quantity: 1, reason: 'NATS offline check' }, randomUUID());
    assert.equal(changed.quantity, 1);
    await waitFor(async () => !!(await inventory.collection('outbox').findOne({ 'payload.productId': product.id, status: 'PENDING' })), 'pending outbox during outage');
    assert.equal(await audits.countDocuments({ 'event.productId': product.id }), 0);
    report.checks.push('Stock commits and outbox retains event while NATS is offline');
    systemctl('start', 'stockflow-nats');
    await waitFor(async () => (await audits.countDocuments({ 'event.productId': product.id })) === 1, 'automatic NATS recovery and audit');
    assert.equal(await inventory.collection('stock_movements').countDocuments({ productId: product.id }), 1);
    report.checks.push('NATS reconnects automatically and audit records recovered event exactly once');

    systemctl('stop', 'stockflow-audit');
    const durable = await request('/api/products', { name: `Persistence check ${randomUUID().slice(0, 8)}`, unit: 'pcs', category: 'Verification' });
    report.products.push(durable.id);
    await request(`/api/inventory/${durable.id}/add`, { quantity: 2, reason: 'Retained event check' }, randomUUID());
    await waitFor(async () => !!(await inventory.collection('outbox').findOne({ 'payload.productId': durable.id, status: 'PUBLISHED' })), 'event published with audit stopped');
    assert.equal(await audits.countDocuments({ 'event.productId': durable.id }), 0);
    systemctl('restart', 'stockflow-mongo', 'stockflow-nats');
    await waitFor(async () => (await mongo.db('admin').command({ hello: 1 })).isWritablePrimary, 'MongoDB primary after restart');
    assert.equal(await inventory.collection('inventory').countDocuments({ productId: durable.id, quantityMillis: 2000 }), 1);
    const nats = await connect({ servers: 'nats://127.0.0.1:4322' });
    try {
      const manager = await jetstreamManager(nats);
      const consumer = await manager.consumers.info('STOCK_EVENTS', 'stock-audit');
      assert(consumer.num_pending + consumer.num_ack_pending >= 1, 'Retained event lost');
    } finally { await nats.drain(); }
    report.checks.push('MongoDB stock and unconsumed JetStream event survive infrastructure restart');
    systemctl('restart', 'stockflow-product', 'stockflow-inventory', 'stockflow-bff');
    systemctl('start', 'stockflow-audit');
    await waitFor(async () => (await audits.countDocuments({ 'event.productId': durable.id })) === 1, 'retained event audited after service restart');
    await waitFor(async () => {
      const response = await fetch(base + '/health/ready', { signal: AbortSignal.timeout(3000) });
      return response.ok;
    }, 'public API restored');
    for (const row of previous)
      assert.equal((await request(`/api/inventory/${row.id}`)).quantity, row.quantity, 'Previous stock changed');
    for (const unit of ['mongo', 'nats', 'product', 'inventory', 'bff', 'audit']) {
      assert.equal(execFileSync('systemctl', ['is-active', `stockflow-${unit}`]).toString().trim(), 'active');
      assert.equal(execFileSync('systemctl', ['is-enabled', `stockflow-${unit}`]).toString().trim(), 'enabled');
    }
    report.checks.push('All six services active and enabled; previous balances unchanged after restart');
    assert.equal(execFileSync('sha256sum', ['-c', '/opt/stockflow/baseline/existing-site.sha256']).toString().includes('OK'), true);
    assert.equal((await fetch('https://devutils.click/')).status, 200);
    report.checks.push('Existing Nginx domain configuration unchanged and devutils.click returns HTTP 200');
    fs.writeFileSync('/opt/stockflow/data/verification-report.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    systemctl('start', 'stockflow-mongo', 'stockflow-nats', 'stockflow-product', 'stockflow-inventory', 'stockflow-bff', 'stockflow-audit');
    await mongo.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
