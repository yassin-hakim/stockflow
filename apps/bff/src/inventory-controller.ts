import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type {
  InventoryOverview,
  InventoryRecord,
  Items,
  Product,
  StockChangeResult,
  StockMovement,
} from "@stockflow/contracts";
import { HttpUpstream, UpstreamError } from "./upstream";
import { overview, projectInventory } from "./projection";
import { uuid, requestId, stockBody } from "./validation";

@Controller("api/inventory")
export class InventoryController {
  constructor(
    @Inject("PRODUCT_HTTP") private readonly product: HttpUpstream,
    @Inject("INVENTORY_HTTP") private readonly inventory: HttpUpstream,
  ) {}
  @Get() async list(
    @Req() req: { headers: Record<string, string | undefined> },
  ): Promise<Items<InventoryOverview>> {
    const id = requestId(req);
    const [products, balances] = await Promise.all([
      this.product.request<Items<Product>>("/products", { requestId: id }),
      this.inventory.request<Items<InventoryRecord>>("/inventory", {
        requestId: id,
      }),
    ]);
    return { items: projectInventory(products.items, balances.items) };
  }
  @Get(":productId") async get(
    @Param("productId") rawId: string,
    @Req() req: { headers: Record<string, string | undefined> },
  ): Promise<InventoryOverview> {
    const productId = uuid(rawId, "product ID"),
      id = requestId(req);
    const product = await this.product.request<Product>(
      `/products/${productId}`,
      { requestId: id },
    );
    try {
      const record = await this.inventory.request<InventoryRecord>(
        `/inventory/${productId}`,
        { requestId: id },
      );
      return overview(product, record.quantity);
    } catch (error) {
      if (
        error instanceof UpstreamError &&
        error.code === "INVENTORY_NOT_FOUND"
      )
        return overview(product, 0);
      throw error;
    }
  }
  @Get(":productId/movements") async movements(
    @Param("productId") rawId: string,
    @Req() req: { headers: Record<string, string | undefined> },
  ): Promise<Items<StockMovement>> {
    const productId = uuid(rawId, "product ID"),
      id = requestId(req);
    await this.product.request<Product>(`/products/${productId}`, {
      requestId: id,
    });
    return this.inventory.request(`/inventory/${productId}/movements`, {
      requestId: id,
    });
  }
  @Post(":productId/add") @HttpCode(200) add(
    @Param("productId") rawId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: { headers: Record<string, string | undefined> },
  ): Promise<StockChangeResult> {
    return this.command(rawId, "add", body, key, req);
  }
  @Post(":productId/remove") @HttpCode(200) remove(
    @Param("productId") rawId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: { headers: Record<string, string | undefined> },
  ): Promise<StockChangeResult> {
    return this.command(rawId, "remove", body, key, req);
  }
  private command(
    rawId: string,
    action: "add" | "remove",
    body: unknown,
    key: string | undefined,
    req: { headers: Record<string, string | undefined> },
  ): Promise<StockChangeResult> {
    const productId = uuid(rawId, "product ID");
    uuid(key ?? "", "Idempotency-Key");
    return this.inventory.request(`/inventory/${productId}/${action}`, {
      method: "POST",
      body: stockBody(body),
      idempotencyKey: key,
      requestId: requestId(req),
    });
  }
}
