import { correlationHeaders } from "./request-context";
import type { ProductCatalog } from "../application/stock-use-cases";
import { StockError } from "../domain/stock";

export class HttpProductCatalog implements ProductCatalog {
  constructor(private readonly baseUrl: string) {}
  async exists(productId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/products/${encodeURIComponent(productId)}`,
        { signal: AbortSignal.timeout(5000), headers: correlationHeaders() },
      );
      if (response.status === 404) return false;
      if (!response.ok)
        throw new Error(`Product service status ${response.status}`);
      return true;
    } catch {
      throw new StockError(
        "UPSTREAM_UNAVAILABLE",
        "Product service unavailable.",
      );
    }
  }
  async get(
    productId: string,
  ): Promise<{ id: string; archivedAt?: string | null }> {
    try {
      const response = await fetch(
        `${this.baseUrl}/products/${encodeURIComponent(productId)}`,
        { signal: AbortSignal.timeout(5000), headers: correlationHeaders() },
      );
      if (response.status === 404)
        throw new StockError("PRODUCT_NOT_FOUND", "Product not found.");
      if (!response.ok)
        throw new StockError(
          "UPSTREAM_UNAVAILABLE",
          "Product service unavailable.",
        );
      const value = (await response.json()) as {
        id?: unknown;
        archivedAt?: unknown;
      } | null;
      if (
        !value ||
        value.id !== productId ||
        (value.archivedAt !== undefined &&
          value.archivedAt !== null &&
          (typeof value.archivedAt !== "string" ||
            !Number.isFinite(Date.parse(value.archivedAt))))
      )
        throw new StockError(
          "UPSTREAM_UNAVAILABLE",
          "Product service returned an invalid product.",
        );
      return value as { id: string; archivedAt?: string | null };
    } catch (error) {
      if (error instanceof StockError) throw error;
      throw new StockError(
        "UPSTREAM_UNAVAILABLE",
        "Product service unavailable.",
      );
    }
  }
}
