import { Controller, Get, Inject } from "@nestjs/common";
import { HttpUpstream } from "./upstream";

@Controller("health")
export class HealthController {
  constructor(
    @Inject("PRODUCT_HTTP") private readonly product: HttpUpstream,
    @Inject("INVENTORY_HTTP") private readonly inventory: HttpUpstream,
    @Inject('SALES_HTTP') private readonly sales:HttpUpstream,
  ) {}
  @Get("live") live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    await Promise.all([this.product.health(), this.inventory.health(),this.sales.health()]);
    return { status: "ready" };
  }
}
