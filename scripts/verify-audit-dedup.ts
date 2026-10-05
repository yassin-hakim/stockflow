import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { MongoClient } from 'mongodb';
import { MongoAuditRepository } from '../apps/audit-worker/src/audit';
import type { StockEventV1 } from '@stockflow/contracts';

async function main(): Promise<void> {
  const mongo = await MongoClient.connect(process.env.AUDIT_MONGO_URI ?? 'mongodb://localhost:27017/stockflow_audit?replicaSet=rs0&directConnection=true');
  const nats = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' });
  try {
    const event: StockEventV1 = { schemaVersion: 1, eventId: randomUUID(), eventType: 'StockAdded', movementId: randomUUID(), productId: randomUUID(), quantity: 1, resultingQuantity: 1, reason: 'Duplicate delivery test', occurredAt: new Date().toISOString() };
    const payload = new TextEncoder().encode(JSON.stringify(event));
    await jetstream(nats).publish('inventory.stock.added', payload, { msgID: randomUUID() });
    await jetstream(nats).publish('inventory.stock.added', payload, { msgID: randomUUID() });
    const collection = mongo.db().collection('stock_events');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = await jetstreamManager(nats).then(manager => manager.consumers.info('STOCK_EVENTS', 'stock-audit'));
      if (await collection.countDocuments({ _id: event.eventId }) === 1 && state.num_ack_pending === 0 && state.num_pending === 0) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(await collection.countDocuments({ _id: event.eventId }), 1);
    const state = await jetstreamManager(nats).then(manager => manager.consumers.info('STOCK_EVENTS', 'stock-audit'));
    assert.equal(state.num_ack_pending, 0);
    assert.equal(state.num_pending, 0);
    await assert.rejects(new MongoAuditRepository(mongo).save({ ...event, reason: 'Conflicting payload' }), /Conflicting event payload/);
    process.stdout.write(`Verified duplicate delivery and conflicting payload for ${event.eventId}.\n`);
  } finally { await nats.drain(); await mongo.close(); }
}
void main();
