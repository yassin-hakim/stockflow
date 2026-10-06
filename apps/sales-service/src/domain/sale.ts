import { quantityMillis, MAX_QUANTITY_MILLIS } from "@stockflow/primitives";

export class SalesError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export interface Ingredient {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
}
export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  priceMinor: number;
  currency: string;
  version: number;
  recipeRevision: number;
  ingredients: Ingredient[];
  archivedAt: string | null;
}
export interface CartLine {
  menuItemId: string;
  quantity: number;
}
export interface PricedLine {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  priceMinor: number;
  totalMinor: number;
  recipeRevision: number;
  menuVersion: number;
  ingredients: Ingredient[];
}
export interface ReturnLine {
  saleLineId: string;
  quantity: number;
}
export interface RefundRecord {
  ingredientCostMinor?: number|null;
  id: string;
  saleId: string;
  status: "REFUND_PENDING" | "COMPLETED" | "REJECTED";
  lines: ReturnLine[];
  amountMinor: number;
  currency: string;
  reason: string;
  restock: boolean;
  operationId?: string;
  createdAt: string;
  updatedAt: string;
  error?: { code: string; message: string };
}
export interface SaleRecord {
  ingredientCostMinor?: number|null;
  id: string;
  status: "DRAFT" | "CHECKOUT_PENDING" | "COMPLETED" | "REJECTED" | "CANCELLED";
  locationId: string;
  lines: PricedLine[];
  totalMinor: number;
  currency: string;
  version: number;
  tender: "CASH" | "CARD" | null;
  receiptReference: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  operationId?: string;
  attemptId?: string;
  pendingRefundId?: string;
  refundedCounts?: Record<string, number>;
  error?: { code: string; message: string };
}
export function integer(
  value: unknown,
  label: string,
  allowZero = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1)
  )
    throw new SalesError(
      "INVALID_REQUEST",
      `${label} must be a ${allowZero ? "nonnegative" : "positive"} safe integer.`,
      422,
    );
  return value;
}
export function checked(value: number, label: string): number {
  return integer(value, label, true);
}
export function normalizeCart(lines: CartLine[]): CartLine[] {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100)
    throw new SalesError(
      "INVALID_REQUEST",
      "A cart requires 1–100 lines.",
      400,
    );
  const quantities = new Map<string, number>();
  for (const line of lines)
    quantities.set(
      line.menuItemId,
      checked(
        (quantities.get(line.menuItemId) ?? 0) +
          integer(line.quantity, "Item count"),
        "Item count",
      ),
    );
  return [...quantities]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
}
export function priceCart(
  lines: CartLine[],
  items: CatalogItem[],
  currency: string,
  lineId: (id: string) => string,
): { lines: PricedLine[]; totalMinor: number } {
  let totalMinor = 0;
  const priced = normalizeCart(lines).map((line) => {
    const item = items.find((i) => i.id === line.menuItemId);
    if (!item || item.archivedAt || !item.ingredients.length)
      throw new SalesError(
        "MENU_ITEM_UNAVAILABLE",
        "An item is unavailable for new sales.",
      );
    if (item.currency !== currency)
      throw new SalesError(
        "CURRENCY_MISMATCH",
        "Menu currency differs from Sales currency.",
      );
    integer(item.priceMinor, "Price", true);
    const total = checked(item.priceMinor * line.quantity, "Line total");
    totalMinor = checked(totalMinor + total, "Cart total");
    return {
      id: lineId(item.id),
      menuItemId: item.id,
      name: item.name,
      quantity: line.quantity,
      priceMinor: item.priceMinor,
      totalMinor: total,
      recipeRevision: item.recipeRevision,
      menuVersion: item.version,
      ingredients: item.ingredients.map((i) => ({ ...i })),
    };
  });
  ingredientBundle(priced);
  return { lines: priced, totalMinor };
}
export function ingredientBundle(lines: PricedLine[]) {
  const amounts = new Map<string, number>();
  for (const line of lines)
    for (const ingredient of line.ingredients) {
      const millis = quantityMillis(ingredient.quantity);
      if (millis === null)
        throw new SalesError(
          "INVALID_RECIPE",
          "Recipe quantities require positive base-unit milliunits.",
          422,
        );
      const amount = millis * line.quantity;
      const total = (amounts.get(ingredient.productId) ?? 0) + amount;
      if (
        !Number.isSafeInteger(amount) ||
        !Number.isSafeInteger(total) ||
        total > MAX_QUANTITY_MILLIS
      )
        throw new SalesError(
          "INVALID_RECIPE",
          "Ingredient bundle exceeds the stock quantity limit.",
          422,
        );
      amounts.set(ingredient.productId, total);
    }
  return [...amounts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([productId, millis]) => ({ productId, quantity: millis / 1000 }));
}
export function normalizeRefund(lines: ReturnLine[]): ReturnLine[] {
  if (!Array.isArray(lines) || !lines.length || lines.length > 100)
    throw new SalesError(
      "INVALID_REQUEST",
      "A refund requires 1–100 sale lines.",
      400,
    );
  const amounts = new Map<string, number>();
  for (const line of lines)
    amounts.set(
      line.saleLineId,
      checked(
        (amounts.get(line.saleLineId) ?? 0) +
          integer(line.quantity, "Refund count"),
        "Refund count",
      ),
    );
  return [...amounts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([saleLineId, quantity]) => ({ saleLineId, quantity }));
}
export function refundAmount(
  sale: SaleRecord,
  lines: ReturnLine[],
  previous: RefundRecord[],
): number {
  if (sale.status !== "COMPLETED")
    throw new SalesError(
      "INVALID_SALE_STATE",
      "Only completed sales may be refunded.",
    );
  if (sale.pendingRefundId)
    throw new SalesError(
      "OPERATION_PENDING",
      "Resolve the pending correction first.",
    );
  let total = 0;
  for (const line of normalizeRefund(lines)) {
    const original = sale.lines.find((l) => l.id === line.saleLineId);
    if (!original)
      throw new SalesError(
        "INVALID_REQUEST",
        "Refund line does not belong to this sale.",
        400,
      );
    const used = sale.refundedCounts
      ? (sale.refundedCounts[line.saleLineId] ?? 0)
      : previous
          .filter((r) => r.status !== "REJECTED")
          .flatMap((r) => r.lines)
          .filter((l) => l.saleLineId === line.saleLineId)
          .reduce((n, l) => n + l.quantity, 0);
    if (line.quantity + used > original.quantity)
      throw new SalesError(
        "REFUND_LIMIT_EXCEEDED",
        "Refund quantities exceed remaining sold items.",
      );
    total = checked(
      total + checked(original.priceMinor * line.quantity, "Refund amount"),
      "Refund total",
    );
  }
  return total;
}
