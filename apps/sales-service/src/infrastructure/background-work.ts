import { Injectable, Inject, Logger } from "@nestjs/common";
import { connect } from "@nats-io/transport-node";
import { jetstream } from "@nats-io/jetstream";
import { SalesUseCases } from "../application/sales-use-cases";
import type { OutboxEvent } from "../application/ports";
export class NatsSalesPublisher {
  private connection?: Awaited<ReturnType<typeof connect>>;
  constructor(private readonly url: string) {}
  async publish(event: OutboxEvent) {
    if (!this.connection || this.connection.isClosed())
      this.connection = await connect({
        servers: this.url,
        timeout: 2000,
        maxReconnectAttempts: 3,
      });
    const acknowledgment = await jetstream(this.connection, {
      timeout: 3000,
    }).publish(
      event.subject,
      new TextEncoder().encode(JSON.stringify(event.payload)),
      { msgID: event.eventId },
    );
    if (acknowledgment.stream !== "SALES_EVENTS")
      throw new Error("Sales PubAck from unexpected stream.");
  }
  async onApplicationShutdown() {
    await this.connection?.drain();
  }
}
@Injectable()
export class BackgroundWork {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;
  private readonly logger = new Logger(BackgroundWork.name);
  constructor(
    @Inject("SALES") private readonly sales: SalesUseCases,
    @Inject("SALES_PUBLISHER") private readonly publisher: NatsSalesPublisher,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      if (this.active || this.stopped) return;
      this.active = this.poll().finally(() => {
        this.active = undefined;
      });
    }, 1000);
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
  private async poll() {
    try {
      await this.sales.recover();
    } catch (error) {
      this.logger.warn(`Workflow recovery unavailable: ${String(error)}`);
    }
    try {
      for (const event of await this.sales.store.events(25)) {
        try {
          await this.publisher.publish(event);
          await this.sales.store.published(
            event.eventId,
            new Date().toISOString(),
          );
        } catch (error) {
          const attempts = event.attempts + 1;
          await this.sales.store.failed(
            event.eventId,
            attempts,
            new Date(
              Date.now() + Math.min(60000, 500 * 2 ** Math.min(attempts, 10)),
            ).toISOString(),
          );
          this.logger.warn(`Sales outbox ${event.eventId}: ${String(error)}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Sales outbox unavailable: ${String(error)}`);
    }
  }
}
