import { UseInterceptors } from "@nestjs/common";
import { InventoryQueryValidation } from "./query-validation";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { quantityMillis } from "@stockflow/primitives";
import { historyFilter } from "./management-controller";
import { Warehouses } from "../application/warehouse";
import { StockOperations } from "../application/operations";
import { quantityMillis as parseMillis } from "@stockflow/primitives";
import {
  OperationError,
  type OperationCommand,
  type OperationResult,
} from "../domain/operations";

import {
  id,
  objectBody,
  text,
  version,
  pageLimit,
  operationDto,
} from "./operations-input";
export {
  id,
  objectBody,
  text,
  version,
  pageLimit,
  operationDto,
} from "./operations-input";

@Controller()
@UseInterceptors(InventoryQueryValidation)
export class OperationsController {
  constructor(
    @Inject("WAREHOUSES") private readonly warehouses: Warehouses,
    @Inject("STOCK_OPERATIONS") private readonly operations: StockOperations,
  ) {}
  @Get('receiving-config') receivingConfig(){return {currency:process.env.CURRENCY??'USD'};}
  @Post("stock/:productId/add") @HttpCode(200) manualAdd(
    @Param("productId") productId: string,
    @Body() input: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.manual(productId, input, key, "ADD");
  }
  @Post("stock/:productId/remove") @HttpCode(200) manualRemove(
    @Param("productId") productId: string,
    @Body() input: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.manual(productId, input, key, "REMOVE");
  }
  private async manual(
    productId: string,
    input: unknown,
    key: string | undefined,
    action: "ADD" | "REMOVE",
  ) {
    const body = objectBody(input, [
      "locationId",
      "quantity",
      "reason",
      "reference",
    ]);
    const result = await this.operations.execute({
      id: id(key),
      kind: "MANUAL",
      action,
      locationId: id(body.locationId),
      lines: [
        {
          productId: id(productId),
          quantityMillis: this.quantity(body.quantity),
        },
      ],
      reason: text(body.reason, "reason"),
      reference:
        body.reference === undefined
          ? id(key)
          : text(body.reference, "reference", 100),
    });
    return this.success(result);
  }
  @Post("stock-operations/consume-sale") @HttpCode(200) async consumeSale(
    @Body() input: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    const body = objectBody(input, [
      "operationId",
      "locationId",
      "reference",
      "reason",
      "lines",
      "allocations",
    ]);
    if (id(body.operationId) !== id(key))
      throw new OperationError(
        "IDEMPOTENCY_CONFLICT",
        "Inventory operation ID must match the request key.",
      );
    if (!Array.isArray(body.lines) || !Array.isArray(body.allocations))
      throw new OperationError(
        "INVALID_REQUEST",
        "Provide sale lines and original allocations.",
      );
    const lines = body.lines.map((value) => {
      const line = objectBody(value, ["productId", "quantity"]);
      return {
        productId: id(line.productId),
        quantityMillis: this.quantity(line.quantity),
      };
    });
    const allocations = body.allocations.map((value) => {
      const allocation = objectBody(value, [
        "saleLineId",
        "quantity",
        "ingredients",
      ]);
      if (!Array.isArray(allocation.ingredients))
        throw new OperationError(
          "INVALID_REQUEST",
          "Provide allocation ingredients.",
        );
      return {
        saleLineId: id(allocation.saleLineId),
        quantity: this.soldQuantity(allocation.quantity),
        ingredients: allocation.ingredients.map((value) => {
          const line = objectBody(value, ["productId", "quantity"]);
          return {
            productId: id(line.productId),
            quantityMillis: this.quantity(line.quantity),
          };
        }),
      };
    });
    // Internal commands expose terminal rejection so Sales can safely persist it.
    return operationDto(
      await this.operations.execute({
        id: id(key),
        kind: "SALE",
        locationId: id(body.locationId),
        reason: text(body.reason, "reason"),
        reference: text(body.reference, "sale reference", 100),
        lines,
        allocations,
      }),
    );
  }
  @Post("stock-operations/return-sale") @HttpCode(200) async returnSale(
    @Body() input: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    const body = objectBody(input, [
      "operationId",
      "originalOperationId",
      "returnedItems",
      "reason",
    ]);
    if (id(body.operationId) !== id(key))
      throw new OperationError(
        "IDEMPOTENCY_CONFLICT",
        "Inventory operation ID must match the request key.",
      );
    if (!Array.isArray(body.returnedItems))
      throw new OperationError(
        "INVALID_REQUEST",
        "Choose original sold items.",
      );
    const returnedItems = body.returnedItems.map((value) => {
      const item = objectBody(value, ["saleLineId", "quantity"]);
      return {
        saleLineId: id(item.saleLineId),
        quantity: this.soldQuantity(item.quantity),
      };
    });
    return operationDto(
      await this.operations.returnSale({
        id: id(key),
        originalOperationId: id(body.originalOperationId),
        returnedItems,
        reason: text(body.reason, "return reason"),
      }),
    );
  }
  private quantity(value: unknown) {
    const millis = parseMillis(value);
    if (millis === null)
      throw new OperationError(
        "INVALID_QUANTITY",
        "Use positive quantities with at most three decimal places.",
      );
    return millis;
  }
  private soldQuantity(value: unknown) {
    if (!Number.isSafeInteger(value) || (value as number) < 1)
      throw new OperationError(
        "INVALID_REQUEST",
        "Sold quantity must be a positive whole number.",
      );
    return value as number;
  }
  private success(result: OperationResult) {
    if (result.status === "REJECTED")
      throw new OperationError(result.error!.code, result.error!.message);
    return operationDto(result);
  }
  @Get("locations") async locations() {
    return { items: await this.warehouses.locations() };
  }
  @Post("locations") createLocation(@Body() value: unknown) {
    const body = objectBody(value, ["name"]);
    return this.warehouses.create(text(body.name, "location name", 80));
  }
  @Get("locations/:id") location(@Param("id") value: string) {
    return this.warehouses.location(id(value));
  }
  @Patch("locations/:id") renameLocation(
    @Param("id") value: string,
    @Body() input: unknown,
  ) {
    const body = objectBody(input, ["name", "expectedVersion"]);
    return this.warehouses.rename(
      id(value),
      text(body.name, "location name", 80),
      version(body.expectedVersion),
    );
  }
  @Get("stock") async balances(@Query("locationId") locationId?: string) {
    return {
      items: (
        await this.warehouses.balances(locationId ? id(locationId) : undefined)
      ).map(({ quantityMillis, ...balance }) => ({
        ...balance,
        quantity: quantityMillis / 1000,
      })),
    };
  }
  @Get("stock/:productId/movements") async movements(
    @Param("productId") productId: string,
    @Query("locationId") locationId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("cause") cause?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const page = await this.warehouses.movements(
      id(productId),
      locationId ? id(locationId) : undefined,
      cursor,
      pageLimit(limit),
      historyFilter({ cause, from, to }),
    );
    return {
      ...page,
      items: page.items.map(
        ({
          eventId,
          quantityMillis,
          resultingQuantityMillis,
          lineId,
          ...movement
        }) => ({
          ...movement,
          quantity: quantityMillis / 1000,
          resultingQuantity: resultingQuantityMillis / 1000,
        }),
      ),
    };
  }
  @Get("stock-operations/:id") async operation(@Param("id") value: string) {
    return operationDto(await this.warehouses.operation(id(value)));
  }
  @Get("operations") async listOperations(
    @Query("kind") kind?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("locationId") locationId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    if (
      kind &&
      ![
        "MANUAL",
        "RECEIPT",
        "TRANSFER",
        "WASTE",
        "COUNT",
        "SALE",
        "SALE_RETURN",
      ].includes(kind)
    )
      throw new OperationError("INVALID_REQUEST", "Invalid operation kind.");
    const page = await this.warehouses.operations(
      kind,
      cursor,
      pageLimit(limit),
      historyFilter({ locationId, from, to }),
    );
    return { ...page, items: page.items.map(operationDto) };
  }
  @Get("receipts") receipts(
    @Query("locationId") locationId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.documentList("RECEIPT", locationId, from, to, cursor, limit);
  }
  @Get("transfers") transfers(
    @Query("locationId") locationId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.documentList("TRANSFER", locationId, from, to, cursor, limit);
  }
  @Get("waste") wasteList(
    @Query("locationId") locationId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.documentList("WASTE", locationId, from, to, cursor, limit);
  }
  private async documentList(
    kind: string,
    locationId: string | undefined,
    from: string | undefined,
    to: string | undefined,
    cursor: string | undefined,
    limit: string | undefined,
  ) {
    const page = await this.warehouses.operations(
      kind,
      cursor,
      pageLimit(limit),
      historyFilter({ locationId, from, to }),
    );
    return { ...page, items: page.items.map(operationDto) };
  }
  @Get("reports/inventory") async report(
    @Query("locationId") locationId?: string,
    @Query("productId") productId?: string,
    @Query("cause") cause?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const result = await this.warehouses.report(
      historyFilter({ locationId, productId, cause, from, to }),
      cursor,
      pageLimit(limit),
    );
    return {
      ...result,
      items: result.items.map(
        ({
          eventId,
          lineId,
          quantityMillis,
          resultingQuantityMillis,
          ...row
        }) => ({
          ...row,
          quantity: quantityMillis / 1000,
          resultingQuantity: resultingQuantityMillis / 1000,
        }),
      ),
    };
  }
  @Get("receipts/:id") receipt(@Param("id") value: string) {
    return this.document(value, "RECEIPT");
  }
  @Get("transfers/:id") transferDetail(@Param("id") value: string) {
    return this.document(value, "TRANSFER");
  }
  @Get("waste/:id") wasteDetail(@Param("id") value: string) {
    return this.document(value, "WASTE");
  }
  private async document(value: string, kind: string) {
    const operation = await this.warehouses.operation(id(value));
    if (operation.kind !== kind)
      throw new OperationError(
        "OPERATION_NOT_FOUND",
        "Stock document not found.",
      );
    return operationDto(operation);
  }
  @Post("receipts") @HttpCode(200) receive(
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.execute("RECEIPT", body, key);
  }
  @Post("transfers") @HttpCode(200) transfer(
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.execute("TRANSFER", body, key);
  }
  @Post("waste") @HttpCode(200) waste(
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.execute("WASTE", body, key);
  }
  private async execute(
    kind: OperationCommand["kind"],
    input: unknown,
    key?: string,
  ) {
    const body = objectBody(input, [
      "locationId",
      "destinationLocationId",
      "lines",
      "reason",
      "reference",
      "supplierId",
      "wasteCategory",
    ]);
    if (
      !Array.isArray(body.lines) ||
      !body.lines.length ||
      body.lines.length > 100
    )
      throw new OperationError(
        "INVALID_REQUEST",
        "Provide 1–100 product lines.",
      );
    if (body.destinationLocationId !== undefined && kind !== "TRANSFER")
      throw new OperationError(
        "INVALID_REQUEST",
        "Destination belongs only to a transfer.",
      );
    if (body.supplierId !== undefined && kind !== "RECEIPT")
      throw new OperationError(
        "INVALID_REQUEST",
        "Supplier belongs only to a receipt.",
      );
    if (body.wasteCategory !== undefined && kind !== "WASTE")
      throw new OperationError(
        "INVALID_REQUEST",
        "Waste category belongs only to waste.",
      );
    const lines = body.lines.map((value) => {
      const line = objectBody(value, kind === "RECEIPT" ? ["productId", "quantity", "unitCostMinor"] : ["productId", "quantity"]),
        millis = quantityMillis(line.quantity);
      if (millis === null)
        throw new OperationError(
          "INVALID_QUANTITY",
          "Use positive quantities with at most three decimal places.",
        );
      if(line.unitCostMinor!==undefined&&(!Number.isSafeInteger(line.unitCostMinor)||(line.unitCostMinor as number)<0))throw new OperationError('INVALID_REQUEST','Unit cost must be a nonnegative amount in minor units.');
      return { productId: id(line.productId), quantityMillis: millis, ...(line.unitCostMinor!==undefined?{unitCostMinor:line.unitCostMinor as number}:{}) };
    });
    const command: OperationCommand = {
      id: id(key),
      kind,
      locationId: id(body.locationId),
      lines,
      reason: text(body.reason, "reason"),
      reference: text(body.reference, "reference", 100),
    };
    if (kind === "TRANSFER")
      command.destinationLocationId = id(body.destinationLocationId);
    if (body.supplierId !== undefined) command.supplierId = id(body.supplierId);
    if (kind === "WASTE") {
      if (
        !["SPOILAGE", "DAMAGE", "PREPARATION", "EXPIRED", "OTHER"].includes(
          body.wasteCategory as string,
        )
      )
        throw new OperationError("INVALID_REQUEST", "Choose a waste category.");
      command.wasteCategory =
        body.wasteCategory as OperationCommand["wasteCategory"];
    }
    const result = await this.operations.execute(command);
    return this.success(result);
  }
}
