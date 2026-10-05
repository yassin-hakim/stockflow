import { Controller, Get, Inject, Module } from "@nestjs/common";
import { MongoClient } from "mongodb";
import type { ProductRepository } from "./application/product-repository";
import {
  CreateProduct,
  GetProduct,
  ListProducts,
} from "./application/product-use-cases";
import { MongoProductRepository } from "./infrastructure/mongo-product-repository";
import { ProductController } from "./presentation/product-controller";

@Controller("health")
class HealthController {
  constructor(@Inject("MONGO_CLIENT") private readonly client: MongoClient) {}
  @Get("live") live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    await this.client.db().command({ ping: 1 });
    return { status: "ready" };
  }
}

export class MongoShutdown {
  constructor(private readonly client: MongoClient) {}
  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}

@Module({
  controllers: [ProductController, HealthController],
  providers: [
    {
      provide: MongoShutdown,
      useFactory: (client: MongoClient) => new MongoShutdown(client),
      inject: ["MONGO_CLIENT"],
    },
    {
      provide: "MONGO_CLIENT",
      useFactory: async () => {
        const uri = process.env.MONGO_URI;
        if (!uri) throw new Error("MONGO_URI is required.");
        return MongoClient.connect(uri, { serverSelectionTimeoutMS: 2000 });
      },
    },
    {
      provide: "PRODUCT_REPO",
      useFactory: (client: MongoClient) => new MongoProductRepository(client),
      inject: ["MONGO_CLIENT"],
    },
    {
      provide: "CREATE_PRODUCT",
      useFactory: (repo: ProductRepository) => new CreateProduct(repo),
      inject: ["PRODUCT_REPO"],
    },
    {
      provide: "LIST_PRODUCTS",
      useFactory: (repo: ProductRepository) => new ListProducts(repo),
      inject: ["PRODUCT_REPO"],
    },
    {
      provide: "GET_PRODUCT",
      useFactory: (repo: ProductRepository) => new GetProduct(repo),
      inject: ["PRODUCT_REPO"],
    },
  ],
})
export class ProductModule {}
