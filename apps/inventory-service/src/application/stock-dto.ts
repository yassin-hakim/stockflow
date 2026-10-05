import type { StockChangeResult, StockMovement } from "@stockflow/contracts";
import type { DomainStockMovement, StockChange } from "../domain/stock";

export function stockMovementDto(movement: DomainStockMovement): StockMovement {
  return {
    id: movement.id,
    productId: movement.productId,
    type: movement.type,
    quantity: movement.quantityMillis / 1000,
    reason: movement.reason,
    createdAt: movement.createdAt,
  };
}

export function stockChangeDto(
  change: Pick<StockChange, "item" | "movement">,
): StockChangeResult {
  return {
    productId: change.item.productId,
    quantity: change.item.quantityMillis / 1000,
    movement: stockMovementDto(change.movement),
  };
}
