import { isUuid, quantityMillis } from "@stockflow/primitives";
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { connect } from "@nats-io/transport-node";
import { jetstream } from "@nats-io/jetstream";
import { MongoClient, MongoServerError, type Collection } from "mongodb";
import type { StockEventV1 } from "@stockflow/contracts";
import type { AuditRepository } from "./application/handle-stock-event";
import { HandleStockEvent } from "./application/handle-stock-event";

interface AuditDoc {
  _id: string;
  event: StockEventV1;
  receivedAt: string;
}

export function parseEvent(data: Uint8Array, subject: string): StockEventV1 {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new Error("Invalid event JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid event body.");
  const event = value as Record<string, unknown>;
  const fields = [
    "schemaVersion",
    "eventId",
    "eventType",
    "movementId",
    "productId",
    "quantity",
    "resultingQuantity",
    "reason",
    "occurredAt",
  ];
  if (
    Object.keys(event).length !== fields.length ||
    fields.some((field) => !(field in event))
  )
    throw new Error("Invalid event fields.");
  if (
    event.schemaVersion !== 1 ||
    !isUuid(event.eventId) ||
    !isUuid(event.movementId) ||
    !isUuid(event.productId)
  )
    throw new Error("Unsupported event version or ID.");
  if (event.eventType !== "StockAdded" && event.eventType !== "StockRemoved")
    throw new Error("Unsupported event type.");
  if (
    subject !==
    (event.eventType === "StockAdded"
      ? "inventory.stock.added"
      : "inventory.stock.removed")
  )
    throw new Error("Event type does not match subject.");
  for (const field of ["quantity", "resultingQuantity"]) {
    const n = event[field];
    if (quantityMillis(n, field === "resultingQuantity") === null)
      throw new Error(`Invalid ${field}.`);
  }
  if (
    typeof event.reason !== "string" ||
    !event.reason.trim() ||
    event.reason.length > 200
  )
    throw new Error("Invalid reason.");
  if (
    typeof event.occurredAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.occurredAt) ||
    Number.isNaN(Date.parse(event.occurredAt)) ||
    new Date(event.occurredAt).toISOString() !== event.occurredAt
  )
    throw new Error("Invalid occurredAt.");
  return event as unknown as StockEventV1;
}

export function sameEvent(left: StockEventV1, right: StockEventV1): boolean {
  const fields = [
    "schemaVersion",
    "eventId",
    "eventType",
    "movementId",
    "productId",
    "quantity",
    "resultingQuantity",
    "reason",
    "occurredAt",
  ] as const;
  return fields.every((field) => left[field] === right[field]);
}

export class MongoAuditRepository implements AuditRepository {
  private readonly collection: Collection<AuditDoc>;
  private readonly logger = new Logger(MongoAuditRepository.name);
  constructor(client: MongoClient) {
    this.collection = client.db().collection<AuditDoc>("stock_events");
  }
  async save(event: StockEventV1): Promise<void> {
    try {
      await this.collection.insertOne({
        _id: event.eventId,
        event,
        receivedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!(error instanceof MongoServerError) || Number(error.code) !== 11000)
        throw error;
      const previous = await this.collection.findOne({ _id: event.eventId });
      if (!previous || !sameEvent(previous.event, event))
        throw new Error(`Conflicting event payload for ${event.eventId}.`);
      this.logger.warn(`Duplicate event ${event.eventId} already audited.`);
    }
  }
}

@Injectable()
export class AuditConsumer implements OnModuleInit, OnModuleDestroy {
  private stopped = false;
  private running?: Promise<void>;
  private connection?: Awaited<ReturnType<typeof connect>>;
  private readonly logger = new Logger(AuditConsumer.name);
  constructor(
    @Inject("HANDLE_STOCK_EVENT")
    private readonly handleEvent: HandleStockEvent,
  ) {}
  onModuleInit(): void {
    this.running = this.run();
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    // Bounded pulls finish naturally so persistence and acknowledgment can complete.
    await this.running;
  }
  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        this.connection = await connect({
          servers: process.env.NATS_URL!,
          timeout: 2000,
          maxReconnectAttempts: 3,
        });
        if (this.stopped) break;
        const consumer = await jetstream(this.connection).consumers.get(
          "STOCK_EVENTS",
          "stock-audit",
        );
        const initial = await consumer.info();
        this.logger.log(
          `Attached to stock-audit durable consumer: pending ${initial.num_pending}, ack pending ${initial.num_ack_pending}.`,
        );
        while (!this.stopped) {
          const message = await consumer.next({ expires: 5000 });
          if (!message) continue;
          try {
            const event = parseEvent(message.data, message.subject);
            await this.handleEvent.execute(event);
            message.ack();
            this.logger.log(`Audited ${event.eventId}`);
          } catch (error) {
            this.logger.error(`Event left unacknowledged: ${String(error)}`);
          }
        }
      } catch (error) {
        if (!this.stopped) {
          this.logger.warn(`Consumer reconnect: ${String(error)}`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } finally {
        try {
          await this.connection?.drain();
        } catch {
          await this.connection?.close();
        }
        this.connection = undefined;
      }
    }
  }
}
