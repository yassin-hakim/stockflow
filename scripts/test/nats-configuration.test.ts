import { describe, expect, it } from "vitest";
import {
  AUDIT_CONSUMER_CONFIG,
  STOCK_STREAM_CONFIG,
  assertAuditConsumer,
  assertStockStream,
} from "../lib/nats-configuration";

describe("NATS configuration validation", () => {
  it("accepts the expected stream and consumer", () => {
    expect(() => assertStockStream(STOCK_STREAM_CONFIG)).not.toThrow();
    expect(() => assertAuditConsumer(AUDIT_CONSUMER_CONFIG)).not.toThrow();
  });
  it.each([
    { max_bytes: 1024 },
    { discard: "old" as const },
    { max_msgs_per_subject: 1 },
    { max_age: 1 },
    { no_ack: true },
    { duplicate_window: 0 },
  ])("rejects incompatible retention settings %j", (change) => {
    expect(() =>
      assertStockStream({ ...STOCK_STREAM_CONFIG, ...change }),
    ).toThrow("incompatible");
  });
  it.each([
    { filter_subject: "inventory.stock.added" },
    { filter_subjects: ["inventory.stock.added"] },
    { inactive_threshold: 1 },
    { deliver_subject: "audit.push" },
    { max_deliver: 1 },
  ])("rejects incompatible consumer settings %j", (change) => {
    expect(() =>
      assertAuditConsumer({ ...AUDIT_CONSUMER_CONFIG, ...change }),
    ).toThrow("incompatible");
  });
});
