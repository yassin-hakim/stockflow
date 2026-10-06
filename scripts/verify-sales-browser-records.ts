import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';

// Read-only owner-record assertions for the unique fixture retained by the
// browser verifier. Does not modify any application database.
async function main() {
  const path = resolve('output/playwright/sales-browser-final.json');
  const evidence = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(evidence.passed, true);
  const mongo = await MongoClient.connect(process.env.BROWSER_VERIFY_MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0');
  try {
    const sales = mongo.db(process.env.BROWSER_VERIFY_SALES_DB ?? 'stockflow_sales');
    const inventory = mongo.db(process.env.BROWSER_VERIFY_INVENTORY_DB ?? 'stockflow_inventory');
    const sale = (await sales.collection('sales').findOne({ id: evidence.saleId }))!;
    assert(sale, 'Browser sale must exist in the selected Sales owner database.');
    assert.equal(sale.status, 'COMPLETED');
    const refunds = await sales.collection('refunds').find({ saleId: sale.id }).toArray();
    assert.equal(refunds.length, 2);
    assert(refunds.every(refund => refund.status === 'COMPLETED'));
    assert.equal(refunds.reduce((sum, refund) => sum + refund.amountMinor, 0), 1500);
    const returnRefunds = refunds.filter(refund => refund.restock);
    assert.equal(returnRefunds.length, 1);
    assert.equal(refunds.find(refund => !refund.restock)!.operationId, undefined);
    const commands = await inventory.collection('stock_commands').find({ operationId: { $in: [sale.operationId, returnRefunds[0].operationId] } }).toArray();
    assert.equal(commands.length, 2);
    assert(commands.every(command => command.result.status === 'COMMITTED'));
    assert.equal(await inventory.collection('stock_movements').countDocuments({ operationId: sale.operationId }), 1);
    assert.equal(await inventory.collection('stock_movements').countDocuments({ operationId: returnRefunds[0].operationId }), 1);
    const returned = (await inventory.collection('stock_movements').findOne({ operationId: returnRefunds[0].operationId }))!;
    assert.equal(returned.quantityMillis, 200);
    assert.equal(await sales.collection('receipts').countDocuments({ saleId: sale.id }), 1);
    assert.equal(await sales.collection('checkout_attempts').countDocuments({ saleId: sale.id }), 1);
    assert.equal(await sales.collection('outbox').countDocuments({ 'payload.saleId': sale.id, 'payload.eventType': 'SaleCompleted' }), 1);
    assert.equal(await sales.collection('outbox').countDocuments({ 'payload.saleId': sale.id, 'payload.eventType': 'SaleRefunded' }), 2);
    const balance = (await inventory.collection('inventory').findOne({ productId: evidence.productId, locationId: sale.locationId }))!;
    assert.equal(balance.quantityMillis, 4900);
    evidence.persisted = { checkoutAttempts: 1, receipts: 1, completedRefunds: 2, consumeCommands: 1, consumeMovements: 1, returnCommands: 1, returnMovements: 1, returnMillis: returned.quantityMillis, completedEvents: 1, refundEvents: 2, balanceMillis: balance.quantityMillis, cumulativeRefundMinor: 1500 };
    evidence.recordAssertionsPassed = true;
    writeFileSync(path, JSON.stringify(evidence, null, 2));
    process.stdout.write(`Read-only browser fixture cardinality passed: ${sale.id}\n`);
  } finally { await mongo.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
