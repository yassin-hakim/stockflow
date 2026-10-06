import { BadRequestException } from "@nestjs/common";
import { isUuid, quantityMillis } from "@stockflow/primitives";
import { UpstreamError } from "./upstream";

export function uuid(value: string, label: string): string {
  if (!isUuid(value)) throw new BadRequestException(`Invalid ${label}.`);
  return value;
}
export function requestId(req: {
  headers: Record<string, string | undefined>;
}): string {
  return req.headers["x-request-id"] ?? crypto.randomUUID();
}
export function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException("Invalid request body.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new BadRequestException("Unknown request field.");
  return body;
}
export function decimal(value: unknown, allowZero: boolean): number {
  const millis = quantityMillis(value, allowZero);
  if (millis === null)
    throw new UpstreamError(
      422,
      "INVALID_QUANTITY",
      "Quantity must be positive and use at most three decimal places.",
    );
  return millis / 1000;
}
export function text(value: unknown,label:string,max=200,optional=false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length>max) throw new BadRequestException(`Invalid ${label}.`);
  return value.trim();
}
export function version(value:unknown):number { if (!Number.isSafeInteger(value) || (value as number)<0) throw new BadRequestException('Invalid expectedVersion.'); return value as number; }
export function identifier(value:unknown,label='identifier'):string { if (typeof value !== 'string') throw new BadRequestException(`Invalid ${label}.`); return uuid(value,label); }
export function stockLines(value:unknown,costs=false):{productId:string;quantity:number;unitCostMinor?:number}[] {
  if (!Array.isArray(value) || !value.length || value.length>100) throw new BadRequestException('Provide 1–100 lines.');
  return value.map(input=>{const line=object(input,costs?['productId','quantity','unitCostMinor']:['productId','quantity']);if(line.unitCostMinor!==undefined&&(!Number.isSafeInteger(line.unitCostMinor)||(line.unitCostMinor as number)<0))throw new BadRequestException('Invalid receiving unit cost.');return {productId:identifier(line.productId,'product ID'),quantity:decimal(line.quantity,false),...(line.unitCostMinor!==undefined?{unitCostMinor:line.unitCostMinor as number}:{})};});
}
export function operationBody(input:unknown,kind:string):object {
  const body=object(input,['locationId','destinationLocationId','lines','reason','reference','supplierId','wasteCategory']);
  const result:Record<string,unknown>={locationId:identifier(body.locationId,'location ID'),lines:stockLines(body.lines,kind==='receipts'),reason:text(body.reason,'reason'),reference:text(body.reference,'reference',100)};
  if (kind==='transfers') result.destinationLocationId=identifier(body.destinationLocationId,'destination ID');
  else if (body.destinationLocationId!==undefined) throw new BadRequestException('Destination is only valid for transfers.');
  if (kind==='receipts' && body.supplierId!==undefined) result.supplierId=identifier(body.supplierId,'supplier ID');
  else if (body.supplierId!==undefined) throw new BadRequestException('Supplier is only valid for receiving.');
  if (kind==='waste') { if (!['SPOILAGE','DAMAGE','PREPARATION','EXPIRED','OTHER'].includes(body.wasteCategory as string)) throw new BadRequestException('Invalid waste category.'); result.wasteCategory=body.wasteCategory; }
  else if (body.wasteCategory!==undefined) throw new BadRequestException('Waste category is only valid for waste.');
  return result;
}
export function validatedQuery(query:Record<string,string>,allowed:string[]):Record<string,string> {
  if (Object.keys(query).some(key=>!allowed.includes(key))) throw new BadRequestException('Unknown query parameter.');
  for (const [key,value] of Object.entries(query)) {
    if (typeof value!=='string') throw new BadRequestException('Invalid query parameter.');
    if (['locationId','productId'].includes(key)) uuid(value,key);
    if (key==='limit' && (!/^\d+$/.test(value) || Number(value)<1 || Number(value)>100)) throw new BadRequestException('Page size must be 1–100.');
    if (['from','to'].includes(key) && (!/^\d{4}-\d\d-\d\dT.*Z$/.test(value) || Number.isNaN(Date.parse(value)))) throw new BadRequestException('Invalid UTC date range.');
    if (key==='cursor' && value.length>1024) throw new BadRequestException('Invalid cursor.');
  }
  if(query.from && query.to && query.from>=query.to) throw new BadRequestException('from must be earlier than to.');
  return query;
}
export function productBody(value: unknown): object {
  const body = object(value, ["name", "unit", "category", "lowStockThreshold", "sku"]);
  if (body.sku !== undefined && body.sku !== null && typeof body.sku !== 'string') throw new BadRequestException('Invalid SKU.');
  for (const [key, max] of [
    ["name", 100],
    ["unit", 20],
    ["category", 80],
  ] as const)
    if (
      typeof body[key] !== "string" ||
      !(body[key] as string).trim() ||
      (body[key] as string).trim().length > max
    )
      throw new BadRequestException(`Invalid ${key}.`);
  if (body.lowStockThreshold !== undefined) {
    try {
      decimal(body.lowStockThreshold, true);
    } catch {
      throw new BadRequestException("Invalid lowStockThreshold.");
    }
  }
  return body;
}
export function stockBody(value: unknown): object {
  const body = object(value, ["quantity", "reason"]);
  decimal(body.quantity, false);
  if (
    typeof body.reason !== "string" ||
    !body.reason.trim() ||
    body.reason.trim().length > 200
  )
    throw new BadRequestException("Invalid reason.");
  return body;
}

export function productEditBody(value: unknown): object {
  const body = object(value,['name','category','lowStockThreshold','sku','expectedVersion']);
  for (const [key,max] of [['name',100],['category',80]] as const) if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > max) throw new BadRequestException(`Invalid ${key}.`);
  if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) throw new BadRequestException('Invalid expectedVersion.');
  if (body.sku !== undefined && body.sku !== null && typeof body.sku !== 'string') throw new BadRequestException('Invalid SKU.');
  decimal(body.lowStockThreshold,true);
  return body;
}
export function archiveBody(value: unknown): object {
  const body = object(value,['expectedVersion']);
  if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) throw new BadRequestException('Invalid expectedVersion.');
  return body;
}
