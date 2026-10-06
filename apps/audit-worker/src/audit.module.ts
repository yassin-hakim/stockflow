import { Module } from "@nestjs/common";
import { MongoClient } from "mongodb";
import { AuditConsumer, MongoAuditRepository } from "./audit";
import { HandleStockEvent } from "./application/handle-stock-event";
import { MongoSalesAuditRepository, SalesAuditConsumer } from './sales-audit';
import { HandleSalesEvent } from './application/handle-sales-event';

export class MongoShutdown {
  constructor(private readonly client: MongoClient) {}
  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}

@Module({
  providers: [
    {
      provide: MongoShutdown,
      useFactory: (client: MongoClient) => new MongoShutdown(client),
      inject: [MongoClient],
    },
    {
      provide: MongoClient,
      useFactory: async () => {
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
        return MongoClient.connect(process.env.MONGO_URI, {
          serverSelectionTimeoutMS: 2000,
        });
      },
    },
    {
      provide: MongoAuditRepository,
      useFactory: (client: MongoClient) => new MongoAuditRepository(client),
      inject: [MongoClient],
    },
    {
      provide: "HANDLE_STOCK_EVENT",
      useFactory: (repository: MongoAuditRepository) =>
        new HandleStockEvent(repository),
      inject: [MongoAuditRepository],
    },
    AuditConsumer,
    {provide:MongoSalesAuditRepository,useFactory:(client:MongoClient)=>new MongoSalesAuditRepository(client),inject:[MongoClient]},
    {provide:'HANDLE_SALES_EVENT',useFactory:(repository:MongoSalesAuditRepository)=>new HandleSalesEvent(repository),inject:[MongoSalesAuditRepository]},
    SalesAuditConsumer,
  ],
})
export class AuditModule {}
