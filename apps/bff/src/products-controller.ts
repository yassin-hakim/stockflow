import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type { Items, Product } from "@stockflow/contracts";
import { HttpUpstream } from "./upstream";
import { uuid, requestId, productBody, productEditBody, archiveBody } from "./validation";

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

  @Patch(':id') edit(@Param('id') id: string, @Body() body: unknown, @Req() req: { headers: Record<string, string | undefined> }): Promise<Product> {
    return this.product.request(`/products/${uuid(id, 'product ID')}`, { method: 'PATCH', body: productEditBody(body), requestId: requestId(req) });
  }

  @Post(':id/archive') archive(@Param('id') id: string, @Body() body: unknown, @Req() req: { headers: Record<string, string | undefined> }): Promise<Product> {
    return this.product.request(`/products/${uuid(id, 'product ID')}/archive`, { method: 'POST', body: archiveBody(body), requestId: requestId(req) });
  }
}
