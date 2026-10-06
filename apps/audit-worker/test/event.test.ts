import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, MongoServerError } from "mongodb";
import { MongoAuditRepository, parseEvent } from "../src/audit";
import type { StockEventV1 } from "@stockflow/contracts";

const event = {
  schemaVersion: 1,
  eventId: randomUUID(),
  eventType: "StockAdded",
  movementId: randomUUID(),
  productId: randomUUID(),
  quantity: 1.25,
  resultingQuantity: 1.25,
  reason: "Supplier delivery",
  occurredAt: new Date().toISOString(),
};
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

describe("audit event boundary", () => {
  it('accepts v2 operation metadata without weakening v1 validation', () => {
    const v2 = { ...event, schemaVersion: 2, locationId: randomUUID(), operationId: randomUUID(), cause: 'TRANSFER' };
    expect(parseEvent(bytes(v2), 'inventory.stock.added')).toEqual(v2);
    expect(() => parseEvent(bytes({ ...v2, cause: 'Unknown' }), 'inventory.stock.added')).toThrow();
    expect(() => parseEvent(bytes({ ...event, locationId: randomUUID() }), 'inventory.stock.added')).toThrow();
  });
  it("accepts a valid v1 event on its subject", () =>
    expect(parseEvent(bytes(event), "inventory.stock.added")).toEqual(event));
  it("rejects mismatched subject, unsupported version and invalid quantity", () => {
    expect(() => parseEvent(bytes(event), "inventory.stock.removed")).toThrow();
    expect(() =>
      parseEvent(
        bytes({ ...event, schemaVersion: 2 }),
        "inventory.stock.added",
      ),
    ).toThrow();
    expect(() =>
      parseEvent(bytes({ ...event, quantity: 0 }), "inventory.stock.added"),
    ).toThrow();
  });
  it.each(["eventId", "movementId", "productId"])(
    "rejects an array-valued %s",
    (field) => {
      expect(() =>
        parseEvent(
          bytes({ ...event, [field]: [event[field as keyof typeof event]] }),
          "inventory.stock.added",
        ),
      ).toThrow("ID");
    },
  );
  it("accepts a valid large committed balance and rejects finer precision", () => {
    expect(
      parseEvent(
        bytes({ ...event, resultingQuantity: 134217728.001 }),
        "inventory.stock.added",
      ).resultingQuantity,
    ).toBe(134217728.001);
    expect(() =>
      parseEvent(
        bytes({ ...event, resultingQuantity: 134217728.0001 }),
        "inventory.stock.added",
      ),
    ).toThrow("resultingQuantity");
  });
  it("rejects normalized invalid dates and unsupported event types", () => {
    expect(() =>
      parseEvent(
        bytes({ ...event, occurredAt: "2026-02-30T00:00:00.000Z" }),
        "inventory.stock.added",
      ),
    ).toThrow("occurredAt");
    expect(() =>
      parseEvent(bytes({ ...event, eventType: "Unknown" }), "invalid"),
    ).toThrow();
  });
  it("accepts reordered duplicate fields but rejects changed field values", async () => {
    const existing = event as StockEventV1;
    const collection = {
      insertOne: vi.fn(async () => {
        throw new MongoServerError({ code: 11000, message: "duplicate" });
      }),
      findOne: vi.fn(async () => ({ _id: event.eventId, event: existing })),
    };
    const client = {
      db: () => ({ collection: () => collection }),
    } as unknown as MongoClient;
    const repository = new MongoAuditRepository(client);
    const reordered = Object.fromEntries(
      Object.entries(event).reverse(),
    ) as StockEventV1;
    await expect(repository.save(reordered)).resolves.toBeUndefined();
    await expect(
      repository.save({ ...existing, reason: "Different" }),
    ).rejects.toThrow("Conflicting");
  });
});
