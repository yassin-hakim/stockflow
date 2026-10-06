import { valuePlan } from "./valuation";
import { randomUUID } from "node:crypto";
import { MAX_QUANTITY_MILLIS } from "@stockflow/primitives";

export const DEFAULT_LOCATION_ID = "00000000-0000-4000-8000-000000000001";
export type OperationKind =
  | "MANUAL"
  | "RECEIPT"
  | "TRANSFER"
  | "WASTE"
  | "COUNT"
  | "SALE"
  | "SALE_RETURN";
export class OperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface Balance {
  valueMinor?: number | null;
  valueCurrency?:string;
  productId: string;
  locationId: string;
  quantityMillis: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface OperationLine {
  unitCostMinor?: number;
  productId: string;
  quantityMillis: number;
}
export interface ExpectedBalance {
  productId: string;
  version: number | null;
}
export interface IngredientAllocation {
  saleLineId: string;
  quantity: number;
  ingredients: OperationLine[];
}
export interface OperationCommand {
  id: string;
  kind: OperationKind;
  locationId: string;
  destinationLocationId?: string;
  lines: OperationLine[];
  reason: string;
  reference: string;
  action?: "ADD" | "REMOVE";
  expectedBalances?: ExpectedBalance[];
  countId?: string;
  countVersion?: number;
  supplierId?: string;
  wasteCategory?: "SPOILAGE" | "DAMAGE" | "PREPARATION" | "EXPIRED" | "OTHER";
  allocations?: IngredientAllocation[];
  originalOperationId?: string;
  returnedItems?: { saleLineId: string; quantity: number }[];
}
export interface OperationMovement {
  costMinor?: number | null;
  id: string;
  lineId: string;
  productId: string;
  locationId: string;
  operationId: string;
  type: "ADD" | "REMOVE";
  quantityMillis: number;
  resultingQuantityMillis: number;
  cause: OperationKind;
  reason: string;
  createdAt: string;
  eventId: string;
}
export interface OperationResult {
  currency?:string;
  id: string;
  kind: OperationKind;
  status: "COMMITTED" | "REJECTED";
  createdAt: string;
  reference: string;
  reason: string;
  locationId: string;
  destinationLocationId?: string;
  movements: OperationMovement[];
  error?: { code: string; message: string };
  command: OperationCommand;
}
export interface OperationPlan {
  balances: Balance[];
  movements: OperationMovement[];
}

export function balanceIdentity(productId: string, locationId: string): string {
  return `${productId}:${locationId}`;
}

export function normalizeOperation(
  command: OperationCommand,
): OperationCommand {
  if (!command.reason.trim() || command.reason.trim().length > 200)
    throw new OperationError(
      "INVALID_REQUEST",
      "A reason of 1–200 characters is required.",
    );
  if (!command.reference.trim() || command.reference.trim().length > 100)
    throw new OperationError(
      "INVALID_REQUEST",
      "A reference of 1–100 characters is required.",
    );
  if (!command.lines.length || command.lines.length > 100)
    throw new OperationError("INVALID_REQUEST", "Provide 1–100 product lines.");
  if (
    command.kind === "TRANSFER" &&
    (!command.destinationLocationId ||
      command.locationId === command.destinationLocationId)
  )
    throw new OperationError(
      "INVALID_REQUEST",
      "Choose different source and destination locations.",
    );
  if (command.kind === "MANUAL" && !command.action)
    throw new OperationError(
      "INVALID_REQUEST",
      "Choose Add stock or Remove stock.",
    );
  const costs = new Map<string, number | undefined>();
  const combined = new Map<string, number>();
  for (const line of command.lines) {
    if(line.unitCostMinor!==undefined && (command.kind!=='RECEIPT'||!Number.isSafeInteger(line.unitCostMinor)||line.unitCostMinor<0))throw new OperationError('INVALID_REQUEST','Receipt unit cost must be a nonnegative monetary amount.');
    if(combined.has(line.productId) && costs.get(line.productId)!==line.unitCostMinor)throw new OperationError('INVALID_REQUEST','Repeated receipt products must use the same unit cost.');
    costs.set(line.productId,line.unitCostMinor);
    if (
      !Number.isSafeInteger(line.quantityMillis) ||
      line.quantityMillis < (command.kind === "COUNT" ? 0 : 1) ||
      line.quantityMillis > MAX_QUANTITY_MILLIS
    )
      throw new OperationError(
        "INVALID_QUANTITY",
        "Use positive quantities with at most three decimal places.",
      );
    if (command.kind === "COUNT" && combined.has(line.productId))
      throw new OperationError(
        "INVALID_REQUEST",
        "A product can occur only once in a count.",
      );
    const quantity = (combined.get(line.productId) ?? 0) + line.quantityMillis;
    if (!Number.isSafeInteger(quantity) || quantity > MAX_QUANTITY_MILLIS)
      throw new OperationError(
        "INVALID_QUANTITY",
        "Combined quantity exceeds the allowed limit.",
      );
    combined.set(line.productId, quantity);
  }
  const normalized = {
    ...command,
    reason: command.reason.trim(),
    reference: command.reference.trim(),
    lines: [...combined]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([productId, quantityMillis]) => ({ productId, quantityMillis, ...(costs.get(productId)!==undefined?{unitCostMinor:costs.get(productId)}:{}) })),
  };
  if (command.expectedBalances)
    normalized.expectedBalances = [...command.expectedBalances].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    );
  if (command.kind === "SALE") {
    if (!command.allocations?.length || command.allocations.length > 100)
      throw new OperationError(
        "INVALID_REQUEST",
        "Provide the original sale item allocations.",
      );
    const ids = new Set<string>(),
      totals = new Map<string, number>();
    normalized.allocations = command.allocations
      .map((allocation) => {
        if (
          ids.has(allocation.saleLineId) ||
          !Number.isSafeInteger(allocation.quantity) ||
          allocation.quantity < 1 ||
          !allocation.ingredients.length ||
          allocation.ingredients.length > 100
        )
          throw new OperationError(
            "INVALID_REQUEST",
            "Invalid sale allocation.",
          );
        ids.add(allocation.saleLineId);
        const ingredients = new Map<string, number>();
        for (const ingredient of allocation.ingredients) {
          if (
            !Number.isSafeInteger(ingredient.quantityMillis) ||
            ingredient.quantityMillis < 1
          )
            throw new OperationError(
              "INVALID_QUANTITY",
              "Invalid recipe quantity.",
            );
          const quantity =
            (ingredients.get(ingredient.productId) ?? 0) +
            ingredient.quantityMillis;
          const total =
            (totals.get(ingredient.productId) ?? 0) +
            ingredient.quantityMillis * allocation.quantity;
          if (
            !Number.isSafeInteger(quantity) ||
            !Number.isSafeInteger(total) ||
            total > MAX_QUANTITY_MILLIS
          )
            throw new OperationError(
              "INVALID_QUANTITY",
              "Ingredient total exceeds the stock limit.",
            );
          ingredients.set(ingredient.productId, quantity);
          totals.set(ingredient.productId, total);
        }
        return {
          ...allocation,
          ingredients: [...ingredients]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([productId, quantityMillis]) => ({
              productId,
              quantityMillis,
            })),
        };
      })
      .sort((a, b) => a.saleLineId.localeCompare(b.saleLineId));
    const allocated = [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([productId, quantityMillis]) => ({ productId, quantityMillis }));
    if (JSON.stringify(allocated) !== JSON.stringify(normalized.lines))
      throw new OperationError(
        "INVALID_REQUEST",
        "Sale ingredient totals do not match the frozen allocations.",
      );
  }
  if (command.returnedItems)
    normalized.returnedItems = [...command.returnedItems].sort((a, b) =>
      a.saleLineId.localeCompare(b.saleLineId),
    );
  return normalized;
}

/** Returns use the immutable per-item recipe stored at consumption time. */
export function returnLines(
  original: OperationCommand,
  returnedItems: { saleLineId: string; quantity: number }[],
): OperationLine[] {
  if (
    original.kind !== "SALE" ||
    !original.allocations ||
    !returnedItems.length ||
    returnedItems.length > 100
  )
    throw new OperationError(
      "INVALID_REQUEST",
      "Choose original sold items to return.",
    );
  const totals = new Map<string, number>(),
    ids = new Set<string>();
  for (const item of returnedItems) {
    const allocation = original.allocations.find(
      (line) => line.saleLineId === item.saleLineId,
    );
    if (
      !allocation ||
      ids.has(item.saleLineId) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > allocation.quantity
    )
      throw new OperationError(
        "REFUND_LIMIT_EXCEEDED",
        "Returned items exceed the original sale allocation.",
      );
    ids.add(item.saleLineId);
    for (const ingredient of allocation.ingredients)
      totals.set(
        ingredient.productId,
        (totals.get(ingredient.productId) ?? 0) +
          ingredient.quantityMillis * item.quantity,
      );
  }
  return [...totals].map(([productId, quantityMillis]) => ({
    productId,
    quantityMillis,
  }));
}

export function operationFingerprint(command: OperationCommand): string {
  // Fixed field order and sorted normalized lines make retry identity independent of JSON key order.
  return JSON.stringify([
    command.kind,
    command.locationId,
    command.destinationLocationId ?? null,
    command.lines,
    command.reason,
    command.reference,
    command.action ?? null,
    command.expectedBalances ?? null,
    command.countId ?? null,
    command.countVersion ?? null,
    command.supplierId ?? null,
    command.wasteCategory ?? null,
    command.allocations ?? null,
    command.originalOperationId ?? null,
    command.returnedItems ?? null,
  ]);
}

export function planOperation(
  command: OperationCommand,
  previous: Balance[],
  now = new Date(),
  currency='USD',
): OperationPlan {
  const timestamp = now.toISOString();
  const before = new Map(
    previous.map((balance) => [
      balanceIdentity(balance.productId, balance.locationId),
      balance,
    ]),
  );
  const changes: { productId: string; locationId: string; delta: number }[] =
    [];
  for (const line of command.lines) {
    const source = before.get(
      balanceIdentity(line.productId, command.locationId),
    );
    if (command.kind === "COUNT") {
      const expected = command.expectedBalances?.find(
        (value) => value.productId === line.productId,
      );
      if (!expected || expected.version !== (source?.version ?? null))
        throw new OperationError(
          "COUNT_STALE",
          "Stock changed after this count started. Refresh and recount before applying.",
        );
      changes.push({
        ...line,
        locationId: command.locationId,
        delta: line.quantityMillis - (source?.quantityMillis ?? 0),
      });
    } else {
      const subtract =
        command.kind === "TRANSFER" ||
        command.kind === "WASTE" ||
        command.kind === "SALE" ||
        (command.kind === "MANUAL" && command.action === "REMOVE");
      changes.push({
        ...line,
        locationId: command.locationId,
        delta: subtract ? -line.quantityMillis : line.quantityMillis,
      });
      if (command.kind === "TRANSFER")
        changes.push({
          ...line,
          locationId: command.destinationLocationId!,
          delta: line.quantityMillis,
        });
    }
  }
  changes.sort((a, b) =>
    balanceIdentity(a.productId, a.locationId).localeCompare(
      balanceIdentity(b.productId, b.locationId),
    ),
  );
  const balances: Balance[] = [],
    movements: OperationMovement[] = [];
  for (const [index, change] of changes.entries()) {
    const prior = before.get(
      balanceIdentity(change.productId, change.locationId),
    );
    const quantityMillis = (prior?.quantityMillis ?? 0) + change.delta;
    if (quantityMillis < 0)
      throw new OperationError(
        "INSUFFICIENT_STOCK",
        `Insufficient stock for product ${change.productId}. No lines were changed.`,
      );
    if (
      !Number.isSafeInteger(quantityMillis) ||
      quantityMillis > MAX_QUANTITY_MILLIS
    )
      throw new OperationError(
        "STOCK_LIMIT_EXCEEDED",
        "This operation would exceed the stock limit. No lines were changed.",
      );
    balances.push({
      productId: change.productId,
      locationId: change.locationId,
      quantityMillis,
      version: (prior?.version ?? 0) + 1,
      createdAt: prior?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    if (change.delta !== 0)
      movements.push({
        id: randomUUID(),
        eventId: randomUUID(),
        lineId: String(index),
        productId: change.productId,
        locationId: change.locationId,
        operationId: command.id,
        type: change.delta > 0 ? "ADD" : "REMOVE",
        quantityMillis: Math.abs(change.delta),
        resultingQuantityMillis: quantityMillis,
        cause: command.kind,
        reason: command.reason,
        createdAt: timestamp,
      });
  }
  const plan={balances,movements};
  valuePlan(command,previous,plan,currency);
  return plan;
}
