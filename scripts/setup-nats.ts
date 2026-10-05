import { connect } from '@nats-io/transport-node';
import { AckPolicy, DeliverPolicy, RetentionPolicy, StorageType, jetstreamManager } from '@nats-io/jetstream';

async function main(): Promise<void> {
  const connection = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' });
  try {
    const manager = await jetstreamManager(connection);
    const stream = 'STOCK_EVENTS', durable = 'stock-audit';
    let info;
    try { info = await manager.streams.info(stream); }
    catch { info = await manager.streams.add({ name: stream, subjects: ['inventory.stock.*'], retention: RetentionPolicy.Workqueue, storage: StorageType.File, num_replicas: 1, max_age: 0, max_msgs: -1, max_bytes: -1, duplicate_window: 120_000_000_000 }); }
    if (info.config.retention !== RetentionPolicy.Workqueue || info.config.storage !== StorageType.File || info.config.num_replicas !== 1 || JSON.stringify(info.config.subjects) !== JSON.stringify(['inventory.stock.*']) || info.config.max_age !== 0 || info.config.max_msgs !== -1) throw new Error('Existing STOCK_EVENTS stream has incompatible settings.');
    let consumer;
    try { consumer = await manager.consumers.info(stream, durable); }
    catch { consumer = await manager.consumers.add(stream, { durable_name: durable, ack_policy: AckPolicy.Explicit, deliver_policy: DeliverPolicy.All, max_deliver: -1, backoff: [1, 5, 30, 300].map(seconds => seconds * 1_000_000_000) }); }
    if (consumer.config.ack_policy !== AckPolicy.Explicit || consumer.config.durable_name !== durable || consumer.config.deliver_policy !== DeliverPolicy.All || consumer.config.max_deliver !== -1 || JSON.stringify(consumer.config.backoff) !== JSON.stringify([1, 5, 30, 300].map(seconds => seconds * 1_000_000_000))) throw new Error('Existing stock-audit consumer has incompatible settings.');
    process.stdout.write(`Ready: ${stream} / ${durable}\n`);
  } finally { await connection.drain(); }
}
void main();
