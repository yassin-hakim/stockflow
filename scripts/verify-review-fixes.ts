import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import type {
  ApiError,
  Product,
  StockChangeResult,
  StockEventV1,
} from "@stockflow/contracts";
import { MongoAuditRepository } from "../apps/audit-worker/src/audit";

const bff = process.env.BFF_URL ?? "http://localhost:3000";
async function call<T>(path: string, body?: unknown, key?: string) {
  const response = await fetch(`${bff}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function main(): Promise<void> {
  const inventory = await MongoClient.connect(
    process.env.INVENTORY_MONGO_URI ??
      "mongodb://localhost:27017/stockflow_inventory?replicaSet=rs0&directConnection=true",
  );
  const audit = await MongoClient.connect(
    process.env.AUDIT_MONGO_URI ??
      "mongodb://localhost:27017/stockflow_audit?replicaSet=rs0&directConnection=true",
  );
  try {
    const created = await call<Product>("/api/products", {
      name: `Review large quantity ${randomUUID().slice(0, 8)}`,
      unit: "kg",
      category: "Review",
      lowStockThreshold: 536870912.001,
    });
    assert.equal(created.status, 201);
    const id = created.body.id;
    const add = (quantity: number, key = randomUUID()) =>
      call<StockChangeResult>(
        `/api/inventory/${id}/add`,
        { quantity, reason: "Review quantity" },
        key,
      );
    assert.equal((await add(134217728)).status, 200);
    const fraction = await add(0.001);
    assert.equal(fraction.status, 200);
    assert.equal(fraction.body.quantity, 134217728.001);
    const invalid = await call<ApiError>(
      `/api/inventory/${id}/add`,
      { quantity: 134217728.0001, reason: "Invalid precision" },
      randomUUID(),
    );
    assert.equal(invalid.status, 422);
    assert.equal(invalid.body.error.code, "INVALID_QUANTITY");
    const removeKey = randomUUID();
    const remove = () =>
      call<StockChangeResult>(
        `/api/inventory/${id}/remove`,
        { quantity: 134217728.001, reason: "Concurrent same-key removal" },
        removeKey,
      );
    const replays = await Promise.all(Array.from({ length: 8 }, remove));
    assert(replays.every((response) => response.status === 200));
    assert(
      replays.every(
        (response) => response.body.movement.id === replays[0].body.movement.id,
      ),
    );
    assert.equal(
      await inventory
        .db()
        .collection("stock_movements")
        .countDocuments({ productId: id }),
      3,
    );
    assert.equal(
      await inventory
        .db()
        .collection("outbox")
        .countDocuments({ "payload.productId": id }),
      3,
    );
    const events = audit
      .db()
      .collection<{ _id: string; event: StockEventV1 }>("stock_events");
    const deadline = Date.now() + 15000;
    while (
      Date.now() < deadline &&
      (await events.countDocuments({ "event.productId": id })) !== 3
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await events.countDocuments({ "event.productId": id }), 3);
    const audited = await events.findOne({
      "event.movementId": fraction.body.movement.id,
    });
    assert(audited);
    assert.equal(audited.event.resultingQuantity, 134217728.001);
    await new MongoAuditRepository(audit).save(
      Object.fromEntries(
        Object.entries(audited.event).reverse(),
      ) as StockEventV1,
    );
    assert.equal(await events.countDocuments({ _id: audited._id }), 1);
    for (const port of [3000, 3001, 3002]) {
      const unknown = await fetch(
        `http://localhost:${port}/review-route-does-not-exist`,
      );
      assert.equal(unknown.status, 404);
      const oversized = await fetch(
        `http://localhost:${port}/${port === 3000 ? "api/products" : port === 3001 ? "products" : `inventory/${id}/add`}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "x".repeat(110_000) }),
        },
      );
      assert.equal(oversized.status, 413);
    }
    process.stdout.write(
      `Verified review fixes for ${id}: large threshold, exact fractional balance audited, eight same-key removals returned one movement, reordered audit replay, and HTTP 404/413 in all services.\n`,
    );
  } finally {
    await inventory.close();
    await audit.close();
  }
}
void main();
