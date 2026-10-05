import { Module } from "@nestjs/common";
import { ProductsController } from "./products-controller";
import { InventoryController } from "./inventory-controller";
import { HealthController } from "./health-controller";
import { requiredHttpUrl } from "./configuration";
import { HttpUpstream } from "./upstream";

@Module({
  controllers: [ProductsController, InventoryController, HealthController],
  providers: [
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
