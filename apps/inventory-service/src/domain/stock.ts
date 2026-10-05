import { randomUUID } from "node:crypto";
import { MAX_QUANTITY_MILLIS, quantityMillis } from "@stockflow/primitives";

export const MAX_MILLIS = MAX_QUANTITY_MILLIS;
export type StockErrorCode =
  | "INVALID_QUANTITY"
  | "INSUFFICIENT_STOCK"
  | "STOCK_LIMIT_EXCEEDED"
  | "INVALID_REQUEST"
  | "IDEMPOTENCY_CONFLICT"
  | "PRODUCT_NOT_FOUND"
  | "INVENTORY_NOT_FOUND"
  | "UPSTREAM_UNAVAILABLE";
export class StockError extends Error {
  constructor(
    public readonly code: StockErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function toMillis(value: unknown, allowZero = false): number {
  const millis = quantityMillis(value, allowZero);
  if (millis === null)
    throw new StockError(
      "INVALID_QUANTITY",
      "Quantity is outside the allowed range or has more than three decimal places.",
    );
  return millis;
}

export interface StockCommand {
  productId: string;
  type: "ADD" | "REMOVE";
  quantityMillis: number;
  reason: string;
  idempotencyKey: string;
}
export interface InventoryItemState {
  productId: string;
  quantityMillis: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface DomainStockMovement {
  id: string;
  productId: string;
  type: "ADD" | "REMOVE";
  quantityMillis: number;
  reason: string;
  createdAt: string;
}
export interface DomainStockEvent {
  eventId: string;
  eventType: "StockAdded" | "StockRemoved";
  movementId: string;
  productId: string;
  quantityMillis: number;
  resultingQuantityMillis: number;
  reason: string;
  occurredAt: string;
}
export interface StockChange {
  item: InventoryItemState;
  movement: DomainStockMovement;
  event: DomainStockEvent;
}

export class InventoryItem {
  constructor(private readonly state: InventoryItemState | null) {}
  addStock(command: StockCommand, now = new Date()): StockChange {
    if (command.type !== "ADD")
      throw new StockError("INVALID_REQUEST", "Expected an add command.");
    return applyChange(this.state, command, now);
  }
  removeStock(command: StockCommand, now = new Date()): StockChange {
    if (command.type !== "REMOVE")
      throw new StockError("INVALID_REQUEST", "Expected a remove command.");
    return applyChange(this.state, command, now);
  }
}

export function changeStock(
  item: InventoryItemState | null,
  command: StockCommand,
  now = new Date(),
): StockChange {
  const aggregate = new InventoryItem(item);
  return command.type === "ADD"
    ? aggregate.addStock(command, now)
    : aggregate.removeStock(command, now);
}

function applyChange(
  item: InventoryItemState | null,
  command: StockCommand,
  now: Date,
): StockChange {
  if (
    !Number.isSafeInteger(command.quantityMillis) ||
    command.quantityMillis <= 0 ||
    command.quantityMillis > MAX_MILLIS
  )
    throw new StockError(
      "INVALID_QUANTITY",
      "Quantity is outside the allowed range.",
    );
  if (!command.reason.trim() || command.reason.trim().length > 200)
    throw new StockError("INVALID_REQUEST", "Invalid reason.");
  const before = item?.quantityMillis ?? 0;
  const after =
    command.type === "ADD"
      ? before + command.quantityMillis
      : before - command.quantityMillis;
  if (after < 0)
    throw new StockError(
      "INSUFFICIENT_STOCK",
      "Cannot remove more stock than is available.",
    );
  if (after > MAX_MILLIS)
    throw new StockError(
      "STOCK_LIMIT_EXCEEDED",
      "Stock limit would be exceeded.",
    );
  const createdAt = now.toISOString();
  const movement: DomainStockMovement = {
    id: randomUUID(),
    productId: command.productId,
    type: command.type,
    quantityMillis: command.quantityMillis,
    reason: command.reason,
    createdAt,
  };
  const event: DomainStockEvent = {
    eventId: randomUUID(),
    eventType: command.type === "ADD" ? "StockAdded" : "StockRemoved",
    movementId: movement.id,
    productId: command.productId,
    quantityMillis: command.quantityMillis,
    resultingQuantityMillis: after,
    reason: command.reason,
    occurredAt: createdAt,
  };
  return {
    item: {
      productId: command.productId,
      quantityMillis: after,
      version: (item?.version ?? 0) + 1,
      createdAt: item?.createdAt ?? createdAt,
      updatedAt: createdAt,
    },
    movement,
    event,
  };
}
