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
import { randomUUID } from "node:crypto";
import { quantityMillis } from "@stockflow/primitives";
import {
  InventoryManagement,
  type CountRecord,
  type HistoryFilter,
  type RuleRecord,
} from "../application/inventory-management";
import { OperationError } from "../domain/operations";
import {
  id,
  objectBody,
  text,
  version,
  pageLimit,
  operationDto,
} from "./operations-input";
export function millis(value: unknown, allowZero = false): number {
  const amount = quantityMillis(value, allowZero);
  if (amount === null)
    throw new OperationError(
      "INVALID_QUANTITY",
      `Use ${allowZero ? "nonnegative" : "positive"} quantities with at most three decimals.`,
    );
  return amount;
}
export function countDto(value: CountRecord) {
  return {
    ...value,
    lines: value.lines.map(({ recordedMillis, countedMillis, ...line }) => ({
      ...line,
      recordedQuantity: recordedMillis / 1000,
      countedQuantity: countedMillis === null ? null : countedMillis / 1000,
      differenceQuantity:
        countedMillis === null ? null : (countedMillis - recordedMillis) / 1000,
    })),
  };
}
export function ruleDto({ lowMillis, targetMillis, ...value }: RuleRecord) {
  return {
    ...value,
    lowStockThreshold: lowMillis / 1000,
    targetQuantity: targetMillis / 1000,
  };
}
export function historyFilter(value: {
  locationId?: string;
  productId?: string;
  cause?: string;
  from?: string;
  to?: string;
}): HistoryFilter {
  const result: HistoryFilter = {};
  if (value.locationId) result.locationId = id(value.locationId);
  if (value.productId) result.productId = id(value.productId);
  if (value.cause) {
    if (
      ![
        "MANUAL",
        "RECEIPT",
        "TRANSFER",
        "WASTE",
        "COUNT",
        "SALE",
        "SALE_RETURN",
      ].includes(value.cause)
    )
      throw new OperationError("INVALID_REQUEST", "Invalid movement cause.");
    result.cause = value.cause;
  }
  for (const field of ["from", "to"] as const) {
    if (value[field]) {
      const date = new Date(value[field]!);
      if (
        !Number.isFinite(date.getTime()) ||
        !/(Z|[+-]\d\d:\d\d)$/.test(value[field]!)
      )
        throw new OperationError(
          "INVALID_REQUEST",
          "Use explicit UTC report instants.",
        );
      result[field] = date.toISOString();
    }
  }
  if (result.from && result.to && result.from >= result.to)
    throw new OperationError(
      "INVALID_REQUEST",
      "Period end must follow its start.",
    );
  return result;
}
@Controller()
@UseInterceptors(InventoryQueryValidation)
export class ManagementController {
  constructor(
    @Inject("INVENTORY_MANAGEMENT")
    private readonly management: InventoryManagement,
  ) {}
  @Get("suppliers") async suppliers() {
    return { items: await this.management.suppliers() };
  }
  @Post("suppliers") supplierCreate(@Body() input: unknown) {
    const body = objectBody(input, ["name", "note"]);
    return this.management.saveSupplier(
      randomUUID(),
      text(body.name, "supplier name", 80),
      this.note(body.note),
      null,
    );
  }
  @Patch("suppliers/:id") supplierEdit(
    @Param("id") key: string,
    @Body() input: unknown,
  ) {
    const body = objectBody(input, ["name", "note", "expectedVersion"]);
    return this.management.saveSupplier(
      id(key),
      text(body.name, "supplier name", 80),
      this.note(body.note),
      version(body.expectedVersion),
    );
  }
  private note(value: unknown) {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > 200)
      throw new OperationError(
        "INVALID_REQUEST",
        "Contact note must be at most 200 characters.",
      );
    return value.trim();
  }
  @Get("counts") async counts(
    @Query("locationId") locationId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const page = await this.management.counts(
      historyFilter({ locationId, from, to }),
      cursor,
      pageLimit(limit),
    );
    return { ...page, items: page.items.map(countDto) };
  }
  @Get("counts/:id") async count(@Param("id") key: string) {
    return countDto(await this.management.count(id(key)));
  }
  @Post("counts") @HttpCode(200) async create(
    @Body() input: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    const body = objectBody(input, ["locationId", "productIds", "reason"]);
    if (!Array.isArray(body.productIds))
      throw new OperationError("INVALID_REQUEST", "Choose count products.");
    return countDto(
      await this.management.createCount(
        id(key),
        id(body.locationId),
        body.productIds.map(id),
        text(body.reason, "count reason"),
      ),
    );
  }
  @Patch("counts/:id") async edit(
    @Param("id") key: string,
    @Body() input: unknown,
  ) {
    const body = objectBody(input, ["expectedVersion", "lines", "reason"]);
    if (!Array.isArray(body.lines) || body.lines.length > 100)
      throw new OperationError("INVALID_REQUEST", "Provide count entries.");
    return countDto(
      await this.management.editCount(
        id(key),
        version(body.expectedVersion),
        body.lines.map((value) => {
          const line = objectBody(value, ["productId", "countedQuantity"]);
          return {
            productId: id(line.productId),
            countedMillis:
              line.countedQuantity === null
                ? null
                : millis(line.countedQuantity, true),
          };
        }),
        body.reason === undefined
          ? undefined
          : text(body.reason, "count reason"),
      ),
    );
  }
  @Post("counts/:id/apply") @HttpCode(200) async apply(
    @Param("id") key: string,
    @Body() input: unknown,
    @Headers("idempotency-key") operationKey?: string,
  ) {
    const body = objectBody(input, ["expectedVersion"]);
    const result = await this.management.applyCount(
      id(key),
      version(body.expectedVersion),
      id(operationKey),
    );
    if (result.status === "REJECTED")
      throw new OperationError(result.error!.code, result.error!.message);
    return operationDto(result);
  }
  @Post("counts/:id/cancel") @HttpCode(200) async cancel(
    @Param("id") key: string,
    @Body() input: unknown,
  ) {
    const body = objectBody(input, ["expectedVersion"]);
    return countDto(
      await this.management.cancelCount(id(key), version(body.expectedVersion)),
    );
  }
  @Get("replenishment-rules") async rules(
    @Query("locationId") locationId?: string,
  ) {
    return {
      items: (
        await this.management.rules(locationId ? id(locationId) : undefined)
      ).map(ruleDto),
    };
  }
  @Post("replenishment-rules") @HttpCode(200) async saveRule(
    @Body() input: unknown,
  ) {
    const body = objectBody(input, [
      "productId",
      "locationId",
      "lowStockThreshold",
      "targetQuantity",
      "expectedVersion",
    ]);
    return ruleDto(
      await this.management.saveRule(
        id(body.productId),
        id(body.locationId),
        millis(body.lowStockThreshold, true),
        millis(body.targetQuantity, true),
        body.expectedVersion === null ? null : version(body.expectedVersion),
      ),
    );
  }
  @Get("replenishment") async replenishment(
    @Query("locationId") locationId?: string,
  ) {
    return {
      items: await this.management.replenishment(
        locationId ? id(locationId) : undefined,
      ),
    };
  }
}
