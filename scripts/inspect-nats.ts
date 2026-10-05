import { connect } from '@nats-io/transport-node';
import { jetstreamManager } from '@nats-io/jetstream';

async function main(): Promise<void> {
  const nats = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' });
  try {
    const manager = await jetstreamManager(nats);
    const stream = await manager.streams.info('STOCK_EVENTS');
    const consumer = await manager.consumers.info('STOCK_EVENTS', 'stock-audit');
    process.stdout.write(JSON.stringify({ streamMessages: stream.state.messages, consumerPending: consumer.num_pending, ackPending: consumer.num_ack_pending, redelivered: consumer.num_redelivered }) + '\n');
  } finally { await nats.drain(); }
}
void main();
