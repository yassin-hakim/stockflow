import { Injectable, Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PublishPendingEvents } from '../application/publish-pending-events';

@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly logger = new Logger(OutboxRelay.name);
  constructor(@Inject('PUBLISH_PENDING') private readonly publishPending: PublishPendingEvents) {}
  onModuleInit(): void { this.timer = setInterval(() => void this.poll(), 500); }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const result = await this.publishPending.execute();
      for (const published of result.published) this.logger.log(`PubAck ${published.eventId} subject ${published.subject} in ${published.receipt.stream} sequence ${published.receipt.sequence}`);
      for (const failure of result.failures) this.logger.warn(`Publish failed for event ${failure.eventId}: ${failure.cause}`);
    } catch (error) { this.logger.warn(`Outbox poll failed: ${String(error)}`); }
    finally { this.busy = false; }
  }
}
