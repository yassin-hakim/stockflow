import { stockChangeDto } from "./stock-dto";
import type {
  InventoryRecord,
  Items,
  StockChangeResult,
  StockMovement,
  StockEventV1,
} from "@stockflow/contracts";
import {
  InventoryItem,
  StockError,
  type InventoryItemState,
  type StockCommand,
  type StockChange,
} from "../domain/stock";

export interface InventoryRepository {
  find(productId: string): Promise<InventoryItemState | null>;
  list(): Promise<Items<InventoryRecord>>;
}
export interface StockMovementRepository {
  findCommand(
    key: string,
  ): Promise<{ command: StockCommand; result: StockChangeResult } | null>;
  movements(productId: string): Promise<Items<StockMovement>>;
}
export interface PersistedStockChange {
  item: InventoryItemState;
  movement: StockChange["movement"];
  event: StockEventV1;
  subject: "inventory.stock.added" | "inventory.stock.removed";
}
export function toPersistedChange(change: StockChange): PersistedStockChange {
  const event = change.event;
  return {
    item: change.item,
    movement: change.movement,
    event: {
      schemaVersion: 1,
      eventId: event.eventId,
      eventType: event.eventType,
      movementId: event.movementId,
      productId: event.productId,
      quantity: event.quantityMillis / 1000,
      resultingQuantity: event.resultingQuantityMillis / 1000,
      reason: event.reason,
      occurredAt: event.occurredAt,
    },
    subject:
      event.eventType === "StockAdded"
        ? "inventory.stock.added"
        : "inventory.stock.removed",
  };
}
export interface StockUnitOfWork {
  commit(
    command: StockCommand,
    before: InventoryItemState | null,
    change: PersistedStockChange,
  ): Promise<boolean>;
}
export interface StockStore
  extends InventoryRepository, StockMovementRepository, StockUnitOfWork {}
export interface ProductCatalog {
  exists(productId: string): Promise<boolean>;
}

export class StockUseCases {
  constructor(
    private readonly store: StockStore,
    private readonly products: ProductCatalog,
  ) {}
  async change(command: StockCommand): Promise<StockChangeResult> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const duplicate = await this.replay(command);
      if (duplicate) return duplicate;
      const before = await this.store.find(command.productId);
      let change: StockChange;
      try {
        if (!before && command.type === "REMOVE")
          throw new StockError(
            "INSUFFICIENT_STOCK",
            "Cannot remove more stock than is available.",
          );
        if (!before && !(await this.products.exists(command.productId)))
          throw new StockError("PRODUCT_NOT_FOUND", "Product not found.");
        const aggregate = new InventoryItem(before);
        change =
          command.type === "ADD"
            ? aggregate.addStock(command)
            : aggregate.removeStock(command);
      } catch (error) {
        // A same-key command may have committed since the initial lookup.
        // Its original outcome takes precedence over rules on the newer balance.
        const committed = await this.replay(command);
        if (committed) return committed;
        throw error;
      }
      if (await this.store.commit(command, before, toPersistedChange(change)))
        return stockChangeDto(change);
    }
    const committed = await this.replay(command);
    if (committed) return committed;
    throw new StockError(
      "UPSTREAM_UNAVAILABLE",
      "Concurrent update could not be resolved.",
    );
  }
  private async replay(
    command: StockCommand,
  ): Promise<StockChangeResult | null> {
    const duplicate = await this.store.findCommand(command.idempotencyKey);
    if (!duplicate) return null;
    const previous = duplicate.command;
    if (
      previous.productId !== command.productId ||
      previous.type !== command.type ||
      previous.quantityMillis !== command.quantityMillis ||
      previous.reason !== command.reason
    ) {
      throw new StockError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key belongs to a different command.",
      );
    }
    return duplicate.result;
  }
  list() {
    return this.store.list();
  }
  async get(productId: string): Promise<InventoryRecord> {
    const item = await this.store.find(productId);
    if (!item)
      throw new StockError(
        "INVENTORY_NOT_FOUND",
        "Inventory record not found.",
      );
    return { productId, quantity: item.quantityMillis / 1000 };
  }
  movements(productId: string) {
    return this.store.movements(productId);
  }
}
