import { Controller, Get, Inject, Module } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { StockUseCases } from './application/stock-use-cases';
import { PublishPendingEvents } from './application/publish-pending-events';
import { HttpProductCatalog } from './infrastructure/product-http-client';
import { MongoStockStore } from './infrastructure/mongo-stock-store';
import { OutboxRelay } from './infrastructure/outbox-relay';
import { NatsEventPublisher } from './infrastructure/nats-event-publisher';
import { InventoryController } from './presentation/inventory-controller';

function requiredUrl(name: 'PRODUCT_SERVICE_URL' | 'NATS_URL', protocol: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  if (new URL(value).protocol !== protocol) throw new Error(`Invalid ${name}.`);
  return value.replace(/\/$/, '');
}

@Controller('health')
class HealthController {
  constructor(@Inject('MONGO_CLIENT') private readonly client: MongoClient, @Inject('STOCK_STORE') private readonly store: MongoStockStore, @Inject('EVENT_PUBLISHER') private readonly publisher: NatsEventPublisher) {}
  @Get('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready() { await this.client.db().command({ ping: 1 }); return { status: 'ready', pendingOutbox: await this.store.outbox.countDocuments({ status: 'PENDING' }), natsConnected: this.publisher.isConnected() }; }
}

@Module({
  controllers: [InventoryController, HealthController],
  providers: [
    { provide: 'MONGO_CLIENT', useFactory: async () => { if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.'); return MongoClient.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 2000 }); } },
    { provide: 'STOCK_STORE', useFactory: async (client: MongoClient) => { const store = new MongoStockStore(client); await store.setup(); return store; }, inject: ['MONGO_CLIENT'] },
    { provide: 'PRODUCT_CATALOG', useFactory: () => new HttpProductCatalog(requiredUrl('PRODUCT_SERVICE_URL', 'http:')) },
    { provide: 'STOCK_USES', useFactory: (store: MongoStockStore, products: HttpProductCatalog) => new StockUseCases(store, products), inject: ['STOCK_STORE', 'PRODUCT_CATALOG'] },
    { provide: 'EVENT_PUBLISHER', useFactory: () => new NatsEventPublisher(requiredUrl('NATS_URL', 'nats:')) },
    { provide: 'PUBLISH_PENDING', useFactory: (store: MongoStockStore, publisher: NatsEventPublisher) => new PublishPendingEvents(store, publisher), inject: ['STOCK_STORE', 'EVENT_PUBLISHER'] },
    OutboxRelay,
  ],
})
export class InventoryModule {}
