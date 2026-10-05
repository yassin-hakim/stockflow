import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { MongoClient } from 'mongodb';
import type { StockEventV1 } from '@stockflow/contracts';

const mongoUri = process.env.MONGO_ADMIN_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222';

async function main(): Promise<void> {
  const mode = process.argv[2], eventId = process.argv[3];
  if (!['prepare', 'check', 'audit'].includes(mode ?? '')) throw new Error('Usage: npm run verify:infrastructure-restart -- prepare | check <eventId> | audit <eventId>');
  if (mode !== 'prepare' && !eventId) throw new Error('Pass the eventId printed by prepare.');
  const mongo = await MongoClient.connect(mongoUri);
  const nats = await connect({ servers: natsUrl });
  try {
    const markers = mongo.db('stockflow_verification').collection<{ _id: string; createdAt: Date }>('restart_markers');
    const manager = await jetstreamManager(nats);
    if (mode === 'prepare') {
      const event: StockEventV1 = { schemaVersion: 1, eventId: randomUUID(), eventType: 'StockAdded', movementId: randomUUID(), productId: randomUUID(), quantity: 1, resultingQuantity: 1, reason: 'Infrastructure restart verification', occurredAt: new Date().toISOString() };
      await markers.insertOne({ _id: event.eventId, createdAt: new Date() });
      await jetstream(nats).publish('inventory.stock.added', new TextEncoder().encode(JSON.stringify(event)), { msgID: event.eventId });
      process.stdout.write(`Prepared MongoDB marker and pending JetStream event ${event.eventId}. Stop and restart Compose without deleting volumes, then run check.\n`);
      return;
    }
    assert.equal(await markers.countDocuments({ _id: eventId }), 1, 'MongoDB marker was lost');
    if (mode === 'check') {
      const state = await manager.consumers.info('STOCK_EVENTS', 'stock-audit');
      assert(state.num_pending + state.num_ack_pending >= 1, 'JetStream pending message was lost');
      process.stdout.write(`Verified MongoDB marker and pending JetStream delivery ${eventId} after restart.\n`);
      return;
    }
    const audits = mongo.db('stockflow_audit').collection('stock_events');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && await audits.countDocuments({ _id: eventId }) !== 1) await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await audits.countDocuments({ _id: eventId }), 1, 'Audit worker did not persist the retained event');
    process.stdout.write(`Verified retained JetStream event ${eventId} was audited once.\n`);
  } finally { await nats.drain(); await mongo.close(); }
}
void main();
