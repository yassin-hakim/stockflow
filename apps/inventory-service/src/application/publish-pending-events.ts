import type { StockEventV1 } from '@stockflow/contracts';

export interface PendingEvent { eventId: string; subject: 'inventory.stock.added' | 'inventory.stock.removed'; payload: StockEventV1; attempts: number }
export interface OutboxRepository {
  findDue(limit: number): Promise<PendingEvent[]>;
  markPublished(eventId: string): Promise<void>;
  markFailed(eventId: string, nextAttemptAt: Date): Promise<void>;
}
export interface PublishReceipt { stream: string; sequence: number }
export interface EventPublisher { publish(event: PendingEvent): Promise<PublishReceipt> }

export class PublishPendingEvents {
  constructor(private readonly outbox: OutboxRepository, private readonly publisher: EventPublisher) {}
  async execute(): Promise<{ published: { eventId: string; subject: PendingEvent['subject']; receipt: PublishReceipt }[]; failures: { eventId: string; cause: string }[] }> {
    const published: { eventId: string; subject: PendingEvent['subject']; receipt: PublishReceipt }[] = [];
    const failures: { eventId: string; cause: string }[] = [];
    for (const event of await this.outbox.findDue(100)) {
      try {
        const receipt = await this.publisher.publish(event);
        await this.outbox.markPublished(event.eventId);
        published.push({ eventId: event.eventId, subject: event.subject, receipt });
      } catch (error) {
        const delays = [1000, 5000, 30000, 300000];
        await this.outbox.markFailed(event.eventId, new Date(Date.now() + delays[Math.min(event.attempts, delays.length - 1)]));
        failures.push({ eventId: event.eventId, cause: String(error) });
        break;
      }
    }
    return { published, failures };
  }
}
