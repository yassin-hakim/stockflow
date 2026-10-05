import { afterEach, describe, expect, it, vi } from "vitest";
import type { MongoClient } from "mongodb";
import type { HandleStockEvent } from "../src/application/handle-stock-event";

const transport = vi.hoisted(() => ({ connect: vi.fn(), jetstream: vi.fn() }));
vi.mock("@nats-io/transport-node", () => ({ connect: transport.connect }));
vi.mock("@nats-io/jetstream", () => ({ jetstream: transport.jetstream }));

import { AuditConsumer } from "../src/audit";
import { MongoShutdown as AuditMongoShutdown } from "../src/audit.module";
import { MongoShutdown as InventoryMongoShutdown } from "../../inventory-service/src/inventory.module";
import { MongoShutdown as ProductMongoShutdown } from "../../product-service/src/product.module";

afterEach(() => vi.clearAllMocks());

describe("audit shutdown", () => {
  it("finishes persistence and acknowledgment before draining the connection", async () => {
    const order: string[] = [];
    let started!: () => void;
    const handling = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const event = {
      schemaVersion: 1,
      eventId: crypto.randomUUID(),
      eventType: "StockAdded",
      movementId: crypto.randomUUID(),
      productId: crypto.randomUUID(),
      quantity: 1,
      resultingQuantity: 1,
      reason: "Delivery",
      occurredAt: new Date().toISOString(),
    };
    const next = vi.fn(async () => ({
      data: new TextEncoder().encode(JSON.stringify(event)),
      subject: "inventory.stock.added",
      ack: () => {
        order.push("ack");
      },
    }));
    transport.connect.mockResolvedValue({
      drain: async () => {
        order.push("drain");
      },
      close: vi.fn(),
    });
    transport.jetstream.mockReturnValue({
      consumers: {
        get: async () => ({
          info: async () => ({ num_pending: 1, num_ack_pending: 0 }),
          next,
        }),
      },
    });
    const handle = {
      execute: async () => {
        started();
        await pending;
        order.push("persist");
      },
    } as unknown as HandleStockEvent;
    const consumer = new AuditConsumer(handle);
    consumer.onModuleInit();
    await handling;
    let closed = false;
    const shutdown = consumer.onModuleDestroy().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(order).toEqual([]);
    finish();
    await shutdown;
    expect(order).toEqual(["persist", "ack", "drain"]);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe.each([
  ["Product", ProductMongoShutdown],
  ["Inventory", InventoryMongoShutdown],
  ["Audit", AuditMongoShutdown],
] as const)("%s MongoDB shutdown", (_name, Shutdown) => {
  it("awaits closing its owned client in the final application shutdown phase", async () => {
    let finish!: () => void;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const resource = new Shutdown({ close } as unknown as MongoClient);
    let finished = false;
    const shutdown = resource.onApplicationShutdown().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    finish();
    await shutdown;
    expect(finished).toBe(true);
  });
});
