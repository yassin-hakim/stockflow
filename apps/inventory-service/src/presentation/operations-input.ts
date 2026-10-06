import { isUuid } from "@stockflow/primitives";
import { OperationError, type OperationResult } from "../domain/operations";
export function objectBody(
  value: unknown,
  allowed: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new OperationError("INVALID_REQUEST", "Invalid request body.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new OperationError("INVALID_REQUEST", "Unknown request field.");
  return body;
}
export function id(value: unknown): string {
  if (!isUuid(value))
    throw new OperationError("INVALID_REQUEST", "Invalid identifier.");
  return value as string;
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new OperationError("INVALID_REQUEST", `Invalid ${label}.`);
  return value.trim();
}
export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new OperationError("INVALID_REQUEST", "Invalid expectedVersion.");
  return value as number;
}
export function pageLimit(value?: string): number {
  const limit = value === undefined ? 50 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new OperationError("INVALID_REQUEST", "Page size must be 1–100.");
  return limit;
}
export function operationDto(value: OperationResult) {
  const { command, ...result } = value;
  const costMovements=result.kind==='TRANSFER'?result.movements.filter(row=>row.type==='REMOVE'):result.movements;
  const totalCost=costMovements.every(row=>row.costMinor!=null)?costMovements.reduce((sum,row)=>sum+BigInt(row.costMinor!),0n):null;
  if(totalCost!==null && totalCost>BigInt(Number.MAX_SAFE_INTEGER)) throw new OperationError('INVALID_REQUEST','Operation cost exceeds monetary precision.');
  return {
    ...result,
    costMinor: result.status==='COMMITTED' && totalCost!==null?Number(totalCost):null,
    currency: result.currency ?? 'USD',
    receivedLines: command.kind==='RECEIPT'?command.lines.map(line=>({productId:line.productId,quantity:line.quantityMillis/1000,unitCostMinor:line.unitCostMinor??null})):undefined,
    ...(command.supplierId ? { supplierId: command.supplierId } : {}),
    ...(command.wasteCategory ? { wasteCategory: command.wasteCategory } : {}),
    movements: result.movements.map(
      ({
        eventId,
        quantityMillis: quantity,
        resultingQuantityMillis,
        lineId,
        ...movement
      }) => ({
        ...movement,
        quantity: quantity / 1000,
        resultingQuantity: resultingQuantityMillis / 1000,
      }),
    ),
  };
}
