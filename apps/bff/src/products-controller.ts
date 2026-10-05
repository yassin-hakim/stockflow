import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Items, Product } from "@stockflow/contracts";
import { HttpUpstream } from "./upstream";
import { uuid, requestId, productBody } from "./validation";

@Controller("api/products")
export class ProductsController {
  constructor(@Inject("PRODUCT_HTTP") private readonly product: HttpUpstream) {}
  @Post() create(
    @Body() body: unknown,
    @Req() req: { headers: Record<string, string | undefined> },
  ): Promise<Product> {
    return this.product.request("/products", {
      method: "POST",
      body: productBody(body),
      requestId: requestId(req),
    });
  }
  @Get() list(
    @Req() req: { headers: Record<string, string | undefined> },
  ): Promise<Items<Product>> {
    return this.product.request("/products", { requestId: requestId(req) });
  }
  @Get(":id") get(
    @Param("id") id: string,
    @Req() req: { headers: Record<string, string | undefined> },
  ): Promise<Product> {
    return this.product.request(`/products/${uuid(id, "product ID")}`, {
      requestId: requestId(req),
    });
  }
}
