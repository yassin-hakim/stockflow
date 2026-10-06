import { connect } from "@nats-io/transport-node";
import {
  JetStreamApiError,
  JetStreamApiCodes,
  DiscardPolicy,
  jetstreamManager,
} from "@nats-io/jetstream";
import {
  AUDIT_CONSUMER,
  AUDIT_CONSUMER_CONFIG,
  STOCK_STREAM,
  STOCK_STREAM_CONFIG,
  assertAuditConsumer,
  assertStockStream,
  SALES_STREAM, SALES_STREAM_CONFIG, SALES_AUDIT_CONSUMER, SALES_AUDIT_CONSUMER_CONFIG, assertSalesStream, assertSalesConsumer,
} from "./lib/nats-configuration";

async function main(): Promise<void> {
  const connection = await connect({
    servers: process.env.NATS_URL ?? "nats://localhost:4222",
  });
  try {
    const manager = await jetstreamManager(connection);
    let stream;
    try {
      stream = await manager.streams.info(STOCK_STREAM);
    } catch (error) {
      if (
        !(error instanceof JetStreamApiError) ||
        error.code !== JetStreamApiCodes.StreamNotFound
      )
        throw error;
      stream = await manager.streams.add(STOCK_STREAM_CONFIG);
    }
    if (
      process.argv.includes("--upgrade-discard-policy") &&
      stream.config.discard === DiscardPolicy.Old
    ) {
      // Upgrade only this safe policy change, after validating every other field.
      // Retained events are never deleted or resources recreated.
      assertStockStream({ ...stream.config, discard: DiscardPolicy.New });
      stream = await manager.streams.update(STOCK_STREAM, {
        discard: DiscardPolicy.New,
      });
    }
    assertStockStream(stream.config);
    let consumer;
    try {
      consumer = await manager.consumers.info(STOCK_STREAM, AUDIT_CONSUMER);
    } catch (error) {
      if (
        !(error instanceof JetStreamApiError) ||
        error.code !== JetStreamApiCodes.ConsumerNotFound
      )
        throw error;
      consumer = await manager.consumers.add(
        STOCK_STREAM,
        AUDIT_CONSUMER_CONFIG,
      );
    }
    assertAuditConsumer(consumer.config);
    process.stdout.write(`Ready: ${STOCK_STREAM} / ${AUDIT_CONSUMER}\n`);
    let salesStream;
    try {salesStream=await manager.streams.info(SALES_STREAM);}catch(error){if(!(error instanceof JetStreamApiError)||error.code!==JetStreamApiCodes.StreamNotFound)throw error;salesStream=await manager.streams.add(SALES_STREAM_CONFIG);}
    assertSalesStream(salesStream.config);
    let salesConsumer;
    try {salesConsumer=await manager.consumers.info(SALES_STREAM,SALES_AUDIT_CONSUMER);}catch(error){if(!(error instanceof JetStreamApiError)||error.code!==JetStreamApiCodes.ConsumerNotFound)throw error;salesConsumer=await manager.consumers.add(SALES_STREAM,SALES_AUDIT_CONSUMER_CONFIG);}
    assertSalesConsumer(salesConsumer.config);
    process.stdout.write(`Ready: ${SALES_STREAM} / ${SALES_AUDIT_CONSUMER}\n`);
  } finally {
    await connection.drain();
  }
}
void main();
