import type {
  InventoryOverview,
  InventoryRecord,
  Product,
  StockStatus,
} from "@stockflow/contracts";

export function overview(
  product: Product,
  quantity: number,
): InventoryOverview {
  const status: StockStatus =
    quantity === 0
      ? "OUT"
      : product.lowStockThreshold > 0 && quantity <= product.lowStockThreshold
        ? "LOW"
        : "OK";
  return { product, quantity, status };
}
export function projectInventory(
  products: Product[],
  balances: InventoryRecord[],
): InventoryOverview[] {
  const byId = new Map(balances.map((row) => [row.productId, row.quantity]));
  return products
    .map((product) => overview(product, byId.get(product.id) ?? 0))
    .sort(
      (a, b) =>
        a.product.name.localeCompare(b.product.name, undefined, {
          sensitivity: "base",
        }) || a.product.id.localeCompare(b.product.id),
    );
}
