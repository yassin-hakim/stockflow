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
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException("Invalid request body.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new BadRequestException("Unknown request field.");
  return body;
}
function decimal(value: unknown, allowZero: boolean): number {
  const millis = quantityMillis(value, allowZero);
  if (millis === null)
    throw new UpstreamError(
      422,
      "INVALID_QUANTITY",
      "Quantity must be positive and use at most three decimal places.",
    );
  return millis / 1000;
}
export function productBody(value: unknown): object {
  const body = object(value, ["name", "unit", "category", "lowStockThreshold"]);
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
