import "reflect-metadata";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import { MongoClient } from "mongodb";
import { ProductModule } from "../apps/product-service/src/product.module";
import { InventoryModule } from "../apps/inventory-service/src/inventory.module";
import { AuditModule } from "../apps/audit-worker/src/audit.module";
import type { PublishPendingEvents } from "../apps/inventory-service/src/application/publish-pending-events";

async function main(): Promise<void> {
  const mongoRoot =
    process.env.MONGO_ADMIN_URI ??
    "mongodb://localhost:27017/?replicaSet=rs0&directConnection=true";
  process.env.PRODUCT_SERVICE_URL ??= "http://localhost:3001";
  process.env.NATS_URL ??= "nats://localhost:4222";
  for (const [name, Module] of [
    ["product", ProductModule],
    ["inventory", InventoryModule],
    ["audit", AuditModule],
  ] as const) {
    const url = new URL(mongoRoot);
    url.pathname = `/stockflow_${name}`;
    process.env.MONGO_URI = url.toString();
    const app = await NestFactory.createApplicationContext(Module, {
      logger: false,
    });
    const client = app.get<MongoClient>(
      name === "audit" ? MongoClient : "MONGO_CLIENT",
    );
    const originalClose = client.close.bind(client);
    let closed = false;
    client.close = async (...args) => {
      await originalClose(...args);
      closed = true;
    };
    let finish: (() => void) | undefined;
    if (name === "inventory") {
      const publish = app.get<PublishPendingEvents>("PUBLISH_PENDING");
      let started!: () => void;
      const active = new Promise<void>((resolve) => {
        started = resolve;
      });
      publish.execute = async () => {
        started();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        assert.equal(
          closed,
          false,
          "Database closed before active outbox work completed.",
        );
        return { published: [], failures: [] };
      };
      await active;
    }
    const shutdown = app.close();
    await Promise.resolve();
    if (finish) {
      assert.equal(closed, false);
      finish();
    }
    await shutdown;
    assert.equal(closed, true, `${name} MongoClient was not closed.`);
    process.stdout.write(
      `Verified ${name} application context closes MongoDB after module work completes.\n`,
    );
  }
}
void main();
