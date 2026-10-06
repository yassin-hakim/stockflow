import { ProfitLoss } from "../application/profit-loss";
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
  Res,
} from "@nestjs/common";
import { isUuid } from "@stockflow/primitives";
import { SalesUseCases } from "../application/sales-use-cases";
import { SalesError, integer, type SaleRecord } from "../domain/sale";
import type { ReportQuery, StoredRefund } from "../application/ports";

function uuid(value: unknown, label: string): string {
  if (!isUuid(value))
    throw new SalesError("INVALID_REQUEST", `${label} must be a UUID.`, 400);
  return value.toLowerCase();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SalesError("INVALID_REQUEST", "Expected a JSON object.", 400);
  return value as Record<string, unknown>;
}
function exact(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some((k) => !keys.includes(k)))
    throw new SalesError("INVALID_REQUEST", "Unexpected request fields.", 400);
}
function reason(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 500)
    throw new SalesError(
      "INVALID_REQUEST",
      "Reason must contain 1–500 characters.",
      400,
    );
  return value.trim();
}
function cart(value: unknown) {
  if (!Array.isArray(value))
    throw new SalesError("INVALID_REQUEST", "Cart lines required.", 400);
  return value.map((v) => {
    const line = object(v);
    exact(line, ["menuItemId", "quantity"]);
    return {
      menuItemId: uuid(line.menuItemId, "Menu item"),
      quantity: integer(line.quantity, "Item quantity"),
    };
  });
}
function refundLines(value: unknown) {
  if (!Array.isArray(value))
    throw new SalesError("INVALID_REQUEST", "Refund lines required.", 400);
  return value.map((v) => {
    const line = object(v);
    exact(line, ["saleLineId", "quantity"]);
    return {
      saleLineId: uuid(line.saleLineId, "Sale line"),
      quantity: integer(line.quantity, "Item quantity"),
    };
  });
}
export function publicSale(sale: SaleRecord) {
  const { attemptId, pendingRefundId, refundedCounts, completedAt, ...dto } =
    sale;
  return { ...dto, lines: sale.lines.map(({ menuVersion, ...line }) => line) };
}
export function publicRefund(refund: StoredRefund) {
  const { command, ...dto } = refund;
  return dto;
}
function pageLimit(value?: string): number {
  const limit = value === undefined ? 25 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new SalesError(
      "INVALID_REQUEST",
      "Limit must be between 1 and 100.",
      400,
    );
  return limit;
}
function queryFields(
  query: Record<string, string | undefined>,
  keys: string[],
) {
  if (
    Object.entries(query).some(
      ([key, value]) => !keys.includes(key) || typeof value !== "string",
    )
  )
    throw new SalesError(
      "INVALID_REQUEST",
      "Unknown or repeated query parameter.",
      400,
    );
}
function date(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new SalesError(
      "INVALID_REQUEST",
      `${label} must be a UTC ISO instant.`,
      400,
    );
  const normalized = new Date(value).toISOString();
  if (normalized !== value.replace(/(?<!\.\d{3})Z$/, ".000Z"))
    throw new SalesError(
      "INVALID_REQUEST",
      `${label} is not a valid calendar instant.`,
      400,
    );
  return normalized;
}
function reportQuery(query: Record<string, string | undefined>): ReportQuery {
  queryFields(query, ["from", "to", "locationId", "limit", "cursor"]);
  const from = date(query.from, "from"),
    to = date(query.to, "to");
  if (from >= to)
    throw new SalesError(
      "INVALID_REQUEST",
      "Report period requires from < to.",
      400,
    );
  return {
    from,
    to,
    limit: pageLimit(query.limit),
    ...(query.locationId
      ? { locationId: uuid(query.locationId, "Location") }
      : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
  };
}
function csv(value: unknown): string {
  if(typeof value==='number')return String(value);
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
@Controller()
export class SalesController {
  constructor(@Inject("SALES") private readonly sales: SalesUseCases) {}
  @Post("sales")
  @HttpCode(200)
  async create(
    @Body() value: unknown,
    @Headers("idempotency-key") key: string,
    @Headers("x-request-id") requestId?: string,
  ) {
    const body = object(value);
    exact(body, ["locationId", "lines"]);
    return publicSale(
      await this.sales.create(
        uuid(key, "Idempotency-Key"),
        {
          locationId: uuid(body.locationId, "Location"),
          lines: cart(body.lines),
        },
        requestId,
      ),
    );
  }
  @Get("sales") async list(@Query() query: Record<string, string | undefined>) {
    queryFields(query, ["status", "search", "locationId", "limit", "cursor"]);
    if (
      query.status &&
      ![
        "DRAFT",
        "CHECKOUT_PENDING",
        "COMPLETED",
        "REJECTED",
        "CANCELLED",
      ].includes(query.status)
    )
      throw new SalesError("INVALID_REQUEST", "Unknown sale state.", 400);
    if (query.search && query.search.length > 100)
      throw new SalesError(
        "INVALID_REQUEST",
        "Search exceeds 100 characters.",
        400,
      );
    const result = await this.sales.store.list({
      limit: pageLimit(query.limit),
      cursor: query.cursor,
      status: query.status,
      search: query.search,
      locationId: query.locationId
        ? uuid(query.locationId, "Location")
        : undefined,
    });
    return { ...result, items: result.items.map(publicSale) };
  }
  @Get("sales/:id") async detail(@Param("id") id: string) {
    const sale = await this.sales.get(uuid(id, "Sale"));
    return {
      ...publicSale(sale),
      refunds: (await this.sales.store.refunds(sale.id)).map(publicRefund),
    };
  }
  @Patch("sales/:id") async edit(
    @Param("id") id: string,
    @Body() value: unknown,
    @Headers("x-request-id") requestId?: string,
  ) {
    const body = object(value);
    exact(body, ["expectedVersion", "locationId", "lines"]);
    return publicSale(
      await this.sales.edit(
        uuid(id, "Sale"),
        {
          expectedVersion: integer(
            body.expectedVersion,
            "Expected version",
            true,
          ),
          locationId: uuid(body.locationId, "Location"),
          lines: cart(body.lines),
        },
        requestId,
      ),
    );
  }
  @Post("sales/:id/checkout")
  @HttpCode(200)
  async checkout(
    @Param("id") id: string,
    @Body() value: unknown,
    @Headers("idempotency-key") key: string,
    @Headers("x-request-id") requestId: string,
    @Res({ passthrough: true })
    response: {
      status: (code: number) => void;
      setHeader: (name: string, value: string) => void;
    },
  ) {
    const body = object(value);
    exact(body, ["expectedVersion", "tender", "locationId"]);
    if (body.tender !== "CASH" && body.tender !== "CARD")
      throw new SalesError(
        "INVALID_REQUEST",
        "Tender must be CASH or CARD.",
        400,
      );
    const result = await this.sales.checkout(
      uuid(id, "Sale"),
      uuid(key, "Idempotency-Key"),
      {
        expectedVersion: integer(
          body.expectedVersion,
          "Expected version",
          true,
        ),
        tender: body.tender,
        locationId: body.locationId
          ? uuid(body.locationId, "Location")
          : undefined,
      },
      requestId,
    );
    if (result.status === "CHECKOUT_PENDING") {
      response.status(202);
      response.setHeader("Location", `/sales/${result.id}`);
    }
    return publicSale(result);
  }
  @Post("sales/:id/cancel") @HttpCode(200) async cancel(
    @Param("id") id: string,
    @Body() value: unknown,
  ) {
    const body = object(value);
    exact(body, ["expectedVersion"]);
    return publicSale(
      await this.sales.cancel(uuid(id, "Sale"), {
        expectedVersion: integer(
          body.expectedVersion,
          "Expected version",
          true,
        ),
      }),
    );
  }
  @Get("sales/:id/receipt") async receipt(@Param("id") id: string) {
    const receipt = await this.sales.store.receipt(uuid(id, "Sale"));
    if (!receipt)
      throw new SalesError(
        "INVALID_SALE_STATE",
        "A receipt is available only for a completed sale.",
        409,
      );
    return { ...publicSale(receipt.sale), issuedAt: receipt.issuedAt };
  }
  @Get("sales/:id/refunds") async refunds(@Param("id") id: string) {
    await this.sales.get(uuid(id, "Sale"));
    return { items: (await this.sales.store.refunds(id)).map(publicRefund) };
  }
  @Get("sales/:id/refunds/:refundId") async refundDetail(
    @Param("id") id: string,
    @Param("refundId") refundId: string,
  ) {
    const refund = await this.sales.store.refund(uuid(refundId, "Refund"));
    if (!refund || refund.saleId !== uuid(id, "Sale"))
      throw new SalesError("SALE_NOT_FOUND", "Sale correction not found.", 404);
    return publicRefund(refund);
  }
  @Post("sales/:id/refunds")
  @HttpCode(200)
  async refund(
    @Param("id") id: string,
    @Body() value: unknown,
    @Headers("idempotency-key") key: string,
    @Headers("x-request-id") requestId: string,
    @Res({ passthrough: true })
    response: {
      status: (code: number) => void;
      setHeader: (name: string, value: string) => void;
    },
  ) {
    const body = object(value);
    exact(body, ["lines", "reason", "restock", "expectedVersion"]);
    if (typeof body.restock !== "boolean")
      throw new SalesError(
        "INVALID_REQUEST",
        "Explicit restock choice required.",
        400,
      );
    const result = await this.sales.refund(
      uuid(id, "Sale"),
      uuid(key, "Idempotency-Key"),
      {
        lines: refundLines(body.lines),
        reason: reason(body.reason),
        restock: body.restock,
        ...(body.expectedVersion !== undefined
          ? {
              expectedVersion: integer(
                body.expectedVersion,
                "Expected version",
                true,
              ),
            }
          : {}),
      },
      requestId,
    );
    if (result.status === "REFUND_PENDING") {
      response.status(202);
      response.setHeader(
        "Location",
        `/sales/${result.saleId}/refunds/${result.id}`,
      );
    }
    return publicRefund(result);
  }
  @Get('reports/profit-loss') profitLoss(@Query() query:Record<string,string|undefined>){return new ProfitLoss(this.sales.store,this.sales.inventory,this.sales.currency).report(reportQuery(query));}
  @Get('reports/profit-loss/export-data') profitLossExportData(@Query()query:Record<string,string|undefined>){return new ProfitLoss(this.sales.store,this.sales.inventory,this.sales.currency).report(reportQuery(query),true);}
  @Get('reports/profit-loss/export') async profitLossCsv(@Query() query:Record<string,string|undefined>,@Res({passthrough:true}) response:{setHeader:(name:string,value:string)=>void}){
    const report=await new ProfitLoss(this.sales.store,this.sales.inventory,this.sales.currency).report(reportQuery(query),true);
    const rows=[['Metric','Amount (minor units)','Currency'],['Gross sales',report.grossSalesMinor,report.currency],['Refunds',report.refundMinor,report.currency],['Net sales',report.netRevenueMinor,report.currency],['Ingredient cost',report.ingredientCostMinor??'Incomplete',report.currency],['Gross profit',report.grossProfitMinor??'Unavailable',report.currency],['Missing cost records',report.missingCostRecords,''],[],['Kind','Receipt','Occurred at (UTC)','Items','Revenue (minor units)','Ingredient cost (minor units)','Gross profit (minor units)','Currency'],...report.items.map(row=>[row.kind,row.reference.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/ig,'receipt'),row.occurredAt,row.lines.map(line=>`${line.quantity} × ${line.name}`).join('; '),row.revenueMinor,row.costMinor??'Unrecorded',row.grossProfitMinor??'Unavailable',row.currency])];
    response.setHeader('Content-Type','text/csv; charset=utf-8');response.setHeader('Content-Disposition','attachment; filename="profit-loss-report.csv"');
    return '\uFEFF'+rows.map(row=>row.map(csv).join(',')).join('\r\n');
  }
  @Get("reports/sales") report(
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.sales.store.report(reportQuery(query), this.sales.currency);
  }
  @Get("reports/sales/export") async export(
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true })
    response: { setHeader: (name: string, value: string) => void },
  ) {
    const filters = reportQuery(query);
    const rows: string[] = [
      [
        "Kind",
        "Record ID",
        "Sale ID",
        "Receipt",
        "Occurred at (UTC)",
        "Location ID",
        "Amount (minor units)",
        "Currency",
        "Items",
      ]
        .map(csv)
        .join(","),
    ];
    let count = 0;
    let next: string | undefined = undefined;
    do {
      const result = await this.sales.store.report(
        { ...filters, cursor: next, limit: 100 },
        this.sales.currency,
      );
      for (const row of result.items) {
        count++;
        if (count > 10000)
          throw new SalesError(
            "INVALID_REQUEST",
            "Export exceeds 10,000 records; narrow the period.",
            422,
          );
        rows.push(
          [
            row.kind,
            row.id,
            row.saleId,
            row.reference,
            row.occurredAt,
            row.locationId,
            row.amountMinor,
            row.currency,
            row.lines.map((l) => `${l.quantity} × ${l.name}`).join("; "),
          ]
            .map(csv)
            .join(","),
        );
      }
      next = result.nextCursor ?? undefined;
    } while (next);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="sales-report.csv"',
    );
    return "\uFEFF" + rows.join("\r\n");
  }
}
