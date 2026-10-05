import type { ProductCatalog } from "../application/stock-use-cases";
import { StockError } from "../domain/stock";

export class HttpProductCatalog implements ProductCatalog {
  constructor(private readonly baseUrl: string) {}
  async exists(productId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/products/${encodeURIComponent(productId)}`,
        { signal: AbortSignal.timeout(5000) },
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
}
