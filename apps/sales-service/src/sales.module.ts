import { Controller, Get, Inject, Module } from "@nestjs/common";
import { MongoClient } from "mongodb";
import { MongoSalesStore } from "./infrastructure/mongo-sales-store";
import { HttpCatalog, HttpInventory } from "./infrastructure/http-ports";
import { SalesUseCases } from "./application/sales-use-cases";
import { SalesController } from "./presentation/sales-controller";
import {
  BackgroundWork,
  NatsSalesPublisher,
} from "./infrastructure/background-work";
@Controller("health")
class HealthController {
  constructor(@Inject("MONGO_CLIENT") private readonly client: MongoClient) {}
  @Get("live") live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    await this.client
      .db(process.env.MONGO_DB ?? "stockflow_sales")
      .command({ ping: 1 });
    return { status: "ready" };
  }
}
class MongoShutdown {
  constructor(private readonly client: MongoClient) {}
  async onApplicationShutdown() {
    await this.client.close();
  }
}
function httpUrl(name: string, fallback: string) {
  const value = process.env[name] ?? fallback;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`${name} requires an HTTP URL.`);
  return value.replace(/\/$/, "");
}
@Module({
  controllers: [SalesController, HealthController],
  providers: [
    {
      provide: "MONGO_CLIENT",
      useFactory: async () => {
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
        return MongoClient.connect(process.env.MONGO_URI, {
          serverSelectionTimeoutMS: 2000,
        });
      },
    },
    {
      provide: "SALES_STORE",
      useFactory: async (client: MongoClient) => {
        const store = new MongoSalesStore(
          client,
          process.env.MONGO_DB ?? "stockflow_sales",
        );
        await store.setup();
        return store;
      },
      inject: ["MONGO_CLIENT"],
    },
    {
      provide: "SALES",
      useFactory: (store: MongoSalesStore) => {
        const currency = process.env.CURRENCY ?? "USD";
        if (!/^[A-Z]{3}$/.test(currency))
          throw new Error("CURRENCY must be a three-letter currency code.");
        return new SalesUseCases(
          store,
          new HttpCatalog(httpUrl("PRODUCT_URL", "http://127.0.0.1:3001")),
          new HttpInventory(httpUrl("INVENTORY_URL", "http://127.0.0.1:3002")),
          currency,
        );
      },
      inject: ["SALES_STORE"],
    },
    {
      provide: "SALES_PUBLISHER",
      useFactory: () =>
        new NatsSalesPublisher(process.env.NATS_URL ?? "nats://127.0.0.1:4222"),
    },
    BackgroundWork,
    {
      provide: MongoShutdown,
      useFactory: (client: MongoClient) => new MongoShutdown(client),
      inject: ["MONGO_CLIENT"],
    },
  ],
})
export class SalesModule {}
