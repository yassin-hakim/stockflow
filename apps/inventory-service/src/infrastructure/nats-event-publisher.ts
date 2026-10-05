import { connect } from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';
import type { EventPublisher, PendingEvent, PublishReceipt } from '../application/publish-pending-events';

export class NatsEventPublisher implements EventPublisher {
  private connection?: Awaited<ReturnType<typeof connect>>;
  constructor(private readonly url: string) {}
  isConnected(): boolean { return !!this.connection && !this.connection.isClosed() && !this.connection.isDraining(); }
  async publish(event: PendingEvent): Promise<PublishReceipt> {
    if (!this.connection || this.connection.isClosed()) this.connection = await connect({ servers: this.url, timeout: 2000, maxReconnectAttempts: 3 });
    const acknowledgment = await jetstream(this.connection, { timeout: 3000 }).publish(event.subject, new TextEncoder().encode(JSON.stringify(event.payload)), { msgID: event.eventId });
    return { stream: acknowledgment.stream, sequence: acknowledgment.seq };
  }
  async onModuleDestroy(): Promise<void> { await this.connection?.drain(); }
}
