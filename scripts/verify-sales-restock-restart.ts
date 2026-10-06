import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { migrateInventory } from '../apps/inventory-service/src/infrastructure/inventory-migration';
import { DEFAULT_LOCATION_ID } from '../apps/inventory-service/src/domain/operations';

// Run after building the three owner services. Only generated databases and
// processes started here are removed. Main services and shared NATS are untouched.
const runId = randomUUID().replaceAll('-', '');
const artifactRoot = resolve('output/verification', `restock-restart-${runId}`);
const owners = ['product', 'inventory', 'sales'] as const;
type Owner = typeof owners[number];
const databases = Object.fromEntries(owners.map(owner => [owner, `stockflow_restock_${runId}_${owner}`]));
const uri = (owner: Owner) => `mongodb://127.0.0.1:27017/${databases[owner]}?replicaSet=rs0&directConnection=true`;
const children = new Map<Owner, ChildProcess>();
const ports: Record<string, number> = {};
let proxy: Server | undefined;
let fault: 'normal' | 'before' | 'after' = 'normal';
let lostReturnResponse = false;
let returnDispatches = 0;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(label: string, predicate: () => Promise<boolean>, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch {}
    await delay(150);
  }
  throw new Error(`Timed out: ${label}`);
}
async function unusedPort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
function start(owner: Owner) {
  const executable = resolve('apps', `${owner}-service`, 'dist/main.js');
  assert(existsSync(executable), `Build ${owner}-service first.`);
  const env = {
    ...process.env, PORT: String(ports[owner]), MONGO_URI: uri(owner),
    MONGO_DB: databases[owner], CURRENCY: 'USD', PRODUCT_CURRENCY: 'USD',
    // An unused private endpoint keeps verification events out of shared Audit.
    NATS_URL: `nats://127.0.0.1:${ports.unavailableNats}`,
    PRODUCT_SERVICE_URL: `http://127.0.0.1:${ports.product}`,
    PRODUCT_URL: `http://127.0.0.1:${ports.product}`,
    INVENTORY_URL: `http://127.0.0.1:${ports.proxy}`,
  };
  const child = spawn(process.execPath, [executable], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.set(owner, child);
  const log = resolve(artifactRoot, `${owner}-${child.pid}-${Date.now()}.log`);
  child.stdout!.on('data', data => appendFileSync(log, data));
  child.stderr!.on('data', data => appendFileSync(log, data));
  child.on('error', error => appendFileSync(log, String(error)));
  return child.pid!;
}
async function stop(owner: Owner) {
  const child = children.get(owner);
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await Promise.race([exited, delay(5000)]);
  }
  assert(child.exitCode !== null || child.signalCode !== null, `Failed to terminate own ${owner} process.`);
  children.delete(owner);
}
async function ready(owner: Owner) {
  await until(`${owner} ready`, async () => (await fetch(`http://127.0.0.1:${ports[owner]}/health/ready`, { signal: AbortSignal.timeout(2000) })).ok);
}
async function http(owner: Owner, path: string, method = 'GET', body?: unknown, key?: string, expected?: number) {
  const response = await fetch(`http://127.0.0.1:${ports[owner]}${path}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
  });
  const data: any = await response.json();
  assert(expected ? response.status === expected : response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return { status: response.status, data };
}
function faultProxy() {
  proxy = createServer((incoming, outgoing) => {
    if (fault === 'before' || (fault === 'after' && lostReturnResponse)) {
      outgoing.writeHead(503, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Injected private Inventory outage.' } }));
      return;
    }
    const isReturn = incoming.method === 'POST' && incoming.url === '/stock-operations/return-sale';
    if (isReturn) returnDispatches++;
    const upstream = request({ host: '127.0.0.1', port: ports.inventory, path: incoming.url, method: incoming.method, headers: incoming.headers }, response => {
      if (fault === 'after' && isReturn) {
        assert.equal(response.statusCode, 200, 'Injected loss must follow actual successful Inventory response.');
        response.resume();
        response.on('end', () => {
          lostReturnResponse = true;
          outgoing.writeHead(503, { 'Content-Type': 'application/json' });
          outgoing.end(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Injected lost committed stock return response.' } }));
        });
      } else { outgoing.writeHead(response.statusCode!, response.headers); response.pipe(outgoing); }
    });
    upstream.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end(); });
    incoming.pipe(upstream);
  });
  return new Promise<void>(resolve => proxy!.listen(ports.proxy, '127.0.0.1', resolve));
}
async function main() {
  mkdirSync(artifactRoot, { recursive: true });
  for (const name of [...owners, 'proxy', 'unavailableNats']) {
    do { ports[name] = await unusedPort(); } while (Object.values(ports).filter(port => port === ports[name]).length > 1);
  }
  const mongo = await MongoClient.connect(uri('inventory'), { serverSelectionTimeoutMS: 2000 });
  const inventory = mongo.db(databases.inventory), sales = mongo.db(databases.sales);
  const evidence: any = { runId, generatedAt: new Date().toISOString(), ports, databases, isolation: 'Only own generated databases/processes; no shared broker publication.', cases: [] };
  try {
    await migrateInventory(mongo);
    await faultProxy();
    for (const owner of owners) { start(owner); await ready(owner); }
    const product = (await http('product', '/products', 'POST', { name: `Restock restart ${runId}`, category: 'Verification', unit: 'kg', lowStockThreshold: 0 })).data;
    await http('inventory', '/receipts', 'POST', { locationId: DEFAULT_LOCATION_ID, reference: 'Isolated restart verification', reason: 'Verifier delivery', lines: [{ productId: product.id, quantity: 5, unitCostMinor: 1000 }] }, randomUUID());
    let menu = (await http('product', '/menu-items', 'POST', { name: 'Restart espresso', category: 'Verification', priceMinor: 500, currency: 'USD', ingredients: [{ productId: product.id, quantity: 0.1 }] })).data;
    const draft = (await http('sales', '/sales', 'POST', { locationId: DEFAULT_LOCATION_ID, lines: [{ menuItemId: menu.id, quantity: 3 }] }, randomUUID())).data;
    const checkoutKey = randomUUID();
    const completed = (await http('sales', `/sales/${draft.id}/checkout`, 'POST', { expectedVersion: draft.version, tender: 'CASH' }, checkoutKey)).data;
    assert.equal(completed.status, 'COMPLETED');
    const originalReceipt = (await http('sales', `/sales/${draft.id}/receipt`)).data;
    assert.equal(originalReceipt.totalMinor, 1500);
    const saleLineId = completed.lines[0].id;
    const balance = async () => (await inventory.collection('inventory').findOne({ productId: product.id, locationId: DEFAULT_LOCATION_ID }))!.quantityMillis;
    assert.equal(await balance(), 4700);
    for (const [index, phase] of (['before', 'after'] as const).entries()) {
      fault = phase; lostReturnResponse = false;
      const key = randomUUID();
      const body = { lines: [{ saleLineId, quantity: 1 }], reason: `Restart ${phase}: ${'explanation '.repeat(30)}`, restock: true };
      const pending = (await http('sales', `/sales/${draft.id}/refunds`, 'POST', body, key, 202)).data;
      assert.equal(pending.status, 'REFUND_PENDING');
      const stored = (await sales.collection('refunds').findOne({ id: pending.id }))!;
      assert(stored.command && stored.operationId);
      assert.equal(stored.command.originalOperationId, completed.operationId);
      assert.equal(await sales.collection('outbox').countDocuments({ 'payload.referenceId': key }), 0);
      const committedBeforeRestart = await inventory.collection('stock_commands').countDocuments({ operationId: stored.operationId, 'result.status': 'COMMITTED' });
      assert.equal(committedBeforeRestart, phase === 'after' ? 1 : 0);
      assert.equal(await balance(), 4700 + index * 100 + (phase === 'after' ? 100 : 0));
      assert.equal(lostReturnResponse, phase === 'after');
      const overlapping = await http('sales', `/sales/${draft.id}/refunds`, 'POST', { lines: [{ saleLineId, quantity: 1 }], reason: 'Must remain blocked while correction is pending', restock: false }, randomUUID(), 409);
      assert.equal(overlapping.data.error.code, 'OPERATION_PENDING');
      const oldPid = children.get('sales')!.pid!;
      await stop('sales');
      assert.equal((await sales.collection('refunds').findOne({ id: key }))!.status, 'REFUND_PENDING');
      menu = (await http('product', `/menu-items/${menu.id}/publish`, 'POST', { expectedVersion: menu.version, name: menu.name, category: menu.category, priceMinor: 900 + index * 100, currency: 'USD', ingredients: [{ productId: product.id, quantity: 0.4 + index * 0.1 }] })).data;
      fault = 'normal';
      const newPid = start('sales');
      assert.notEqual(newPid, oldPid);
      await ready('sales');
      // Poll GET only: the restarted service's worker must finish the persisted command.
      await until(`automatic ${phase} restock recovery`, async () => (await http('sales', `/sales/${draft.id}/refunds/${key}`)).data.status === 'COMPLETED');
      const terminal = (await http('sales', `/sales/${draft.id}/refunds/${key}`)).data;
      assert.equal(terminal.amountMinor, 500);
      assert.equal(terminal.reason, body.reason.trim());
      assert.equal(terminal.ingredientCostMinor, 100);
      assert.equal(await balance(), 4800 + index * 100);
      const dispatchesAfterRecovery = returnDispatches;
      const replay = (await http('sales', `/sales/${draft.id}/refunds`, 'POST', body, key, 200)).data;
      assert.deepEqual(replay, terminal);
      const checkoutReplay = (await http('sales', `/sales/${draft.id}/checkout`, 'POST', { expectedVersion: draft.version, tender: 'CASH' }, checkoutKey)).data;
      assert.deepEqual(checkoutReplay, completed);
      await delay(1200);
      assert.equal(returnDispatches, dispatchesAfterRecovery, 'Terminal replay must not redispatch a return.');
      assert.equal(await inventory.collection('stock_commands').countDocuments({ operationId: stored.operationId }), 1);
      assert.equal(await inventory.collection('stock_movements').countDocuments({ operationId: stored.operationId }), 1);
      const movement = (await inventory.collection('stock_movements').findOne({ operationId: stored.operationId }))!;
      assert.equal(movement.quantityMillis, 100, 'Restock derives the sold recipe, not the newly published recipe.');
      assert.equal(await sales.collection('refunds').countDocuments({ id: key, status: 'COMPLETED' }), 1);
      assert.equal(await sales.collection('outbox').countDocuments({ 'payload.referenceId': key, 'payload.eventType': 'SaleRefunded' }), 1);
      assert.equal(await sales.collection('receipts').countDocuments({ saleId: draft.id }), 1);
      assert.deepEqual((await http('sales', `/sales/${draft.id}/receipt`)).data, originalReceipt);
      const sale = (await sales.collection('sales').findOne({ id: draft.id }))!;
      assert.equal(sale.refundedCounts[saleLineId], index + 1);
      assert.equal(sale.pendingRefundId, undefined);
      evidence.cases.push({ phase, oldPid, newPid, saleId: draft.id, refundId: key, operationId: stored.operationId, pendingStatusBeforeTermination: 'REFUND_PENDING', committedBeforeRestart, recoveredStatus: terminal.status, returnedMillis: movement.quantityMillis, frozenPriceMinor: terminal.amountMinor, inventoryCommands: 1, inventoryMovements: 1, refundEvents: 1, receiptUnchanged: true, overlapBlocked: true, exactReplay: true });
      process.stdout.write(`Actual Sales termination ${phase === 'before' ? 'before stock return dispatch' : 'after committed Inventory return'} recovered once.\n`);
    }
    const noRestockKey = randomUUID(), noRestockBody = { lines: [{ saleLineId, quantity: 1 }], reason: 'Final item without physical return', restock: false };
    const noRestock = (await http('sales', `/sales/${draft.id}/refunds`, 'POST', noRestockBody, noRestockKey)).data;
    assert.equal(noRestock.status, 'COMPLETED');
    assert.equal(noRestock.operationId, undefined);
    assert.deepEqual((await http('sales', `/sales/${draft.id}/refunds`, 'POST', noRestockBody, noRestockKey)).data, noRestock);
    assert.equal(await balance(), 4900);
    const exceeded = await http('sales', `/sales/${draft.id}/refunds`, 'POST', noRestockBody, randomUUID(), 409);
    assert.equal(exceeded.data.error.code, 'REFUND_LIMIT_EXCEEDED');
    assert.equal(await inventory.collection('stock_commands').countDocuments({ 'command.kind': 'SALE_RETURN' }), 2);
    assert.equal(await inventory.collection('stock_commands').countDocuments({ operationId: completed.operationId }), 1);
    assert.equal(await inventory.collection('stock_movements').countDocuments({ operationId: completed.operationId }), 1);
    assert.equal(await sales.collection('outbox').countDocuments({ 'payload.saleId': draft.id, 'payload.eventType': 'SaleCompleted' }), 1);
    assert.equal(await sales.collection('outbox').countDocuments({ 'payload.saleId': draft.id, 'payload.eventType': 'SaleRefunded' }), 3);
    assert.deepEqual((await http('sales', `/sales/${draft.id}/receipt`)).data, originalReceipt);
    evidence.final = { receipts: 1, consumptions: 1, stockReturns: 2, refunds: 3, noRestockUnchangedBalance: true, cumulativeLimitEnforced: true, finalBalanceMillis: await balance(), terminalCheckoutReplay: true, originalReceipt };
    // Required-source failures use actual owner termination, not a fake port.
    const outageDraft = (await http('sales', '/sales', 'POST', { locationId: DEFAULT_LOCATION_ID, lines: [{ menuItemId: menu.id, quantity: 1 }] }, randomUUID())).data;
    const outageCheckoutKey = randomUUID(), outageCheckoutBody = { expectedVersion: outageDraft.version, tender: 'CASH' };
    await stop('product');
    const catalogFailure = await http('sales', `/sales/${outageDraft.id}/checkout`, 'POST', outageCheckoutBody, outageCheckoutKey, 503);
    assert.equal(catalogFailure.data.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal((await http('sales', `/sales/${outageDraft.id}`)).data.status, 'DRAFT');
    assert.equal(await sales.collection('checkout_attempts').countDocuments({ saleId: outageDraft.id }), 0);
    assert.equal(await inventory.collection('stock_commands').countDocuments({ 'command.reference': outageDraft.id }), 0);
    start('product'); await ready('product');
    const missingMenu = await http('sales', '/sales', 'POST', { locationId: DEFAULT_LOCATION_ID, lines: [{ menuItemId: randomUUID(), quantity: 1 }] }, randomUUID(), 409);
    assert.equal(missingMenu.data.error.code, 'MENU_ITEM_UNAVAILABLE');
    await stop('inventory');
    const inventoryFailure = await http('sales', `/sales/${outageDraft.id}/checkout`, 'POST', outageCheckoutBody, outageCheckoutKey, 202);
    assert.equal(inventoryFailure.data.status, 'CHECKOUT_PENDING');
    assert.equal(await sales.collection('receipts').countDocuments({ saleId: outageDraft.id }), 0);
    start('inventory'); await ready('inventory');
    await until('actual Inventory outage automatic checkout recovery', async () => (await http('sales', `/sales/${outageDraft.id}`)).data.status === 'COMPLETED');
    const outageCompleted = (await http('sales', `/sales/${outageDraft.id}`)).data;
    const outageReceipt = (await http('sales', `/sales/${outageDraft.id}/receipt`)).data;
    assert.equal(await inventory.collection('stock_commands').countDocuments({ operationId: outageCompleted.operationId }), 1);
    assert.equal(await inventory.collection('stock_movements').countDocuments({ operationId: outageCompleted.operationId }), 1);
    assert.equal(await sales.collection('receipts').countDocuments({ saleId: outageDraft.id }), 1);
    const rejectedDraft = (await http('sales', '/sales', 'POST', { locationId: DEFAULT_LOCATION_ID, lines: [{ menuItemId: menu.id, quantity: 100 }] }, randomUUID())).data;
    const rejected = (await http('sales', `/sales/${rejectedDraft.id}/checkout`, 'POST', { expectedVersion: rejectedDraft.version, tender: 'CASH' }, randomUUID())).data;
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.error.code, 'INSUFFICIENT_STOCK');
    assert.equal(await inventory.collection('stock_movements').countDocuments({ operationId: rejected.operationId }), 0);
    assert.equal(await sales.collection('receipts').countDocuments({ saleId: rejected.id }), 0);
    evidence.requiredSources = { productProcessStopped: { httpStatus: 503, code: catalogFailure.data.error.code, draftUnchanged: true, checkoutAttempts: 0, stockCommands: 0 }, missingMenuBusinessError: { httpStatus: 409, code: missingMenu.data.error.code }, inventoryProcessStopped: { httpStatus: 202, status: inventoryFailure.data.status, automaticRecovery: 'COMPLETED', receipts: 1, consumptions: 1 }, insufficientStockBusinessRejection: { status: rejected.status, code: rejected.error.code, movements: 0, receipts: 0 } };
    process.stdout.write('Actual Product/Inventory outages distinguish retryable source failures from business rejection.\n');
    // Actual Mongo rejects the final Sales write after Inventory committed.
    // Preparation remains valid, while finalization's local transaction rolls back.
    await sales.command({ collMod: 'refunds', validator: { status: { $ne: 'COMPLETED' } }, validationLevel: 'strict', validationAction: 'error' });
    const finalizeKey = randomUUID(), finalizeBody = { lines: [{ saleLineId: outageCompleted.lines[0].id, quantity: 1 }], reason: 'Real Mongo finalization rejection', restock: true };
    const mongoFailure = await http('sales', `/sales/${outageDraft.id}/refunds`, 'POST', finalizeBody, finalizeKey, 503);
    assert.equal(mongoFailure.data.error.code, 'SERVICE_UNAVAILABLE');
    const pendingFinalize = (await sales.collection('refunds').findOne({ id: finalizeKey }))!;
    assert.equal(pendingFinalize.status, 'REFUND_PENDING');
    assert.equal(await inventory.collection('stock_commands').countDocuments({ operationId: pendingFinalize.operationId, 'result.status': 'COMMITTED' }), 1);
    assert.equal(await sales.collection('outbox').countDocuments({ 'payload.referenceId': finalizeKey }), 0);
    const saleBeforeFinalize = (await sales.collection('sales').findOne({ id: outageDraft.id }))!;
    assert.equal(saleBeforeFinalize.pendingRefundId, finalizeKey);
    assert.equal(saleBeforeFinalize.refundedCounts[outageCompleted.lines[0].id] ?? 0, 0);
    const finalizeOldPid = children.get('sales')!.pid!;
    await stop('sales');
    await sales.command({ collMod: 'refunds', validator: {} });
    const finalizeNewPid = start('sales'); assert.notEqual(finalizeNewPid, finalizeOldPid); await ready('sales');
    await until('Mongo finalization recovery after actual restart', async () => (await http('sales', `/sales/${outageDraft.id}/refunds/${finalizeKey}`)).data.status === 'COMPLETED');
    const finalized = (await http('sales', `/sales/${outageDraft.id}/refunds/${finalizeKey}`)).data;
    assert.deepEqual((await http('sales', `/sales/${outageDraft.id}/refunds`, 'POST', finalizeBody, finalizeKey)).data, finalized);
    assert.equal(await inventory.collection('stock_commands').countDocuments({ operationId: pendingFinalize.operationId }), 1);
    assert.equal(await inventory.collection('stock_movements').countDocuments({ operationId: pendingFinalize.operationId }), 1);
    assert.equal(await sales.collection('outbox').countDocuments({ 'payload.referenceId': finalizeKey, 'payload.eventType': 'SaleRefunded' }), 1);
    assert.deepEqual((await http('sales', `/sales/${outageDraft.id}/receipt`)).data, outageReceipt);
    const saleAfterFinalize = (await sales.collection('sales').findOne({ id: outageDraft.id }))!;
    assert.equal(saleAfterFinalize.refundedCounts[outageCompleted.lines[0].id], 1);
    assert.equal(saleAfterFinalize.pendingRefundId, undefined);
    assert.equal(await balance(), 4900);
    evidence.mongoFinalization = { errorStatus: 503, errorCode: mongoFailure.data.error.code, validationFailure: 'Actual Mongo collection validator rejects COMPLETED refund replacement.', pendingPersisted: true, localTransactionRolledBack: true, oldPid: finalizeOldPid, newPid: finalizeNewPid, automaticRecovery: finalized.status, inventoryCommands: 1, inventoryMovements: 1, refundEvents: 1, receiptUnchanged: true, exactReplay: true };
    process.stdout.write('Real Mongo finalization rollback and actual Sales restart recovered once.\n');
    evidence.passed = true;
  } finally {
    for (const owner of [...owners].reverse()) await stop(owner);
    if (proxy) await new Promise<void>(resolve => proxy!.close(() => resolve()));
    for (const owner of owners) { assert(databases[owner].startsWith(`stockflow_restock_${runId}_`)); await mongo.db(databases[owner]).dropDatabase(); }
    await mongo.close();
    evidence.cleanedOwnDatabasesAndProcesses = true;
    writeFileSync(resolve(artifactRoot, 'evidence.json'), JSON.stringify(evidence, null, 2));
    if (evidence.passed) writeFileSync(resolve('output/verification/sales-restock-restart.json'), JSON.stringify(evidence, null, 2));
  }
  process.stdout.write(`Sales restock process restart verifier passed: ${artifactRoot}\n`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
