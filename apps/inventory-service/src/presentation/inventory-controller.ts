import { isUuid } from "@stockflow/primitives";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import { StockUseCases } from "../application/stock-use-cases";
import { StockError, toMillis, type StockCommand } from "../domain/stock";

function pathId(id: string): string {
  if (!isUuid(id)) throw new BadRequestException("Invalid product ID.");
  return id;
}
function parseCommand(
  productId: string,
  type: "ADD" | "REMOVE",
  body: unknown,
  key: string | undefined,
): StockCommand {
  if (!isUuid(key)) throw new BadRequestException("Invalid Idempotency-Key.");
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("Invalid stock body.");
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (field) => !["quantity", "reason"].includes(field),
    ) ||
    !("quantity" in input)
  )
    throw new BadRequestException("Invalid stock fields.");
  if (
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.trim().length > 200
  )
    throw new BadRequestException("Invalid reason.");
  return {
    productId: pathId(productId),
    type,
    quantityMillis: toMillis(input.quantity),
    reason: input.reason.trim(),
    idempotencyKey: key!,
  };
}

@Controller("inventory")
export class InventoryController {
  constructor(@Inject("STOCK_USES") private readonly useCases: StockUseCases) {}
  @Get() list() {
    return this.useCases.list();
  }
  @Get(":productId/movements") movements(@Param("productId") id: string) {
    return this.useCases.movements(pathId(id));
  }
  @Get(":productId") get(@Param("productId") id: string) {
    return this.useCases.get(pathId(id));
  }
  @Post(":productId/add") @HttpCode(200) add(
    @Param("productId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.useCases.change(parseCommand(id, "ADD", body, key));
  }
  @Post(":productId/remove") @HttpCode(200) remove(
    @Param("productId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.useCases.change(parseCommand(id, "REMOVE", body, key));
  }
}

export { StockError };
