import { Module } from "@nestjs/common";
import { ProductsController } from "./products-controller";
import { InventoryController } from "./inventory-controller";
import { HealthController } from "./health-controller";
import { requiredHttpUrl } from "./configuration";
import { HttpUpstream } from "./upstream";
import { OperationsController } from './operations-controller';
import { CatalogController } from './catalog-controller';
import { WarehouseController } from './warehouse-controller';
import { SalesController } from './sales-controller';
import { ReportsController } from './reports-controller';

@Module({
  controllers: [ProductsController, InventoryController, OperationsController, CatalogController, WarehouseController, SalesController, ReportsController, HealthController],
  providers: [
    {provide:'SALES_HTTP',useFactory:()=>new HttpUpstream(requiredHttpUrl('SALES_SERVICE_URL'))},
    {
      provide: "PRODUCT_HTTP",
      useFactory: () =>
        new HttpUpstream(requiredHttpUrl("PRODUCT_SERVICE_URL")),
    },
    {
      provide: "INVENTORY_HTTP",
      useFactory: () =>
        new HttpUpstream(requiredHttpUrl("INVENTORY_SERVICE_URL")),
    },
  ],
})
export class BffModule {}
