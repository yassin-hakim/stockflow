import { randomUUID } from 'node:crypto';
import { connect } from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';
import type { StockEventV1 } from '@stockflow/contracts';

async function main(): Promise<void> {
  const event: StockEventV1 = { schemaVersion: 1, eventId: randomUUID(), eventType: 'StockAdded', movementId: randomUUID(), productId: randomUUID(), quantity: 1, resultingQuantity: 1, reason: 'Audit database outage test', occurredAt: new Date().toISOString() };
  const nats = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' });
  try {
    await jetstream(nats).publish('inventory.stock.added', new TextEncoder().encode(JSON.stringify(event)), { msgID: event.eventId });
    process.stdout.write(JSON.stringify({ eventId: event.eventId, productId: event.productId }) + '\n');
  } finally { await nats.drain(); }
}
void main();
