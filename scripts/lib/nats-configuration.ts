import {
  AckPolicy,
  DeliverPolicy,
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  type ConsumerConfig,
  type StreamConfig,
} from "@nats-io/jetstream";

export const STOCK_STREAM = "STOCK_EVENTS";
export const AUDIT_CONSUMER = "stock-audit";
export const SALES_STREAM='SALES_EVENTS';
export const SALES_AUDIT_CONSUMER='sales-audit';
export const STOCK_STREAM_CONFIG: Partial<StreamConfig> & { name: string } = {
  name: STOCK_STREAM,
  subjects: ["inventory.stock.*"],
  retention: RetentionPolicy.Workqueue,
  storage: StorageType.File,
  num_replicas: 1,
  max_age: 0,
  max_msgs: -1,
  max_bytes: -1,
  max_msgs_per_subject: -1,
  discard: DiscardPolicy.New,
  duplicate_window: 120_000_000_000,
};
export const AUDIT_CONSUMER_CONFIG: Partial<ConsumerConfig> = {
  durable_name: AUDIT_CONSUMER,
  ack_policy: AckPolicy.Explicit,
  deliver_policy: DeliverPolicy.All,
  max_deliver: -1,
  backoff: [1, 5, 30, 300].map((seconds) => seconds * 1_000_000_000),
};
export const SALES_STREAM_CONFIG={...STOCK_STREAM_CONFIG,name:SALES_STREAM,subjects:['sales.sale.*']};
export const SALES_AUDIT_CONSUMER_CONFIG={...AUDIT_CONSUMER_CONFIG,durable_name:SALES_AUDIT_CONSUMER};
export function assertSalesStream(config:Partial<StreamConfig>):void {
  if(config.name!==SALES_STREAM || config.subjects?.length!==1 || config.subjects[0]!=='sales.sale.*')throw new Error('Existing SALES_EVENTS stream has incompatible settings.');
  assertStockStream({...config,name:STOCK_STREAM,subjects:['inventory.stock.*']});
}
export function assertSalesConsumer(config:Partial<ConsumerConfig>):void {
  if(config.durable_name!==SALES_AUDIT_CONSUMER)throw new Error('Existing sales-audit consumer has incompatible settings.');
  assertAuditConsumer({...config,durable_name:AUDIT_CONSUMER});
}

export function assertStockStream(config: Partial<StreamConfig>): void {
  const fields = [
    "name",
    "retention",
    "storage",
    "num_replicas",
    "max_age",
    "max_msgs",
    "max_bytes",
    "max_msgs_per_subject",
    "discard",
    "duplicate_window",
  ] as const;
  if (
    fields.some((field) => config[field] !== STOCK_STREAM_CONFIG[field]) ||
    config.subjects?.length !== 1 ||
    config.subjects[0] !== "inventory.stock.*" ||
    config.no_ack
  ) {
    throw new Error("Existing STOCK_EVENTS stream has incompatible settings.");
  }
}

export function assertAuditConsumer(config: Partial<ConsumerConfig>): void {
  const fields = [
    "durable_name",
    "ack_policy",
    "deliver_policy",
    "max_deliver",
  ] as const;
  const backoff = AUDIT_CONSUMER_CONFIG.backoff!;
  if (
    fields.some((field) => config[field] !== AUDIT_CONSUMER_CONFIG[field]) ||
    config.backoff?.length !== backoff.length ||
    backoff.some((delay, i) => config.backoff![i] !== delay) ||
    config.filter_subject ||
    config.filter_subjects?.length ||
    config.deliver_subject ||
    config.inactive_threshold
  ) {
    throw new Error("Existing stock-audit consumer has incompatible settings.");
  }
}
