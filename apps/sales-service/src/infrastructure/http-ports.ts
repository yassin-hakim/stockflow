import { SalesError, type CatalogItem } from "../domain/sale";
import type {
  CatalogPort,
  ConsumeCommand,
  InventoryPort,
  OperationOutcome,
  ReturnCommand,
} from "../application/ports";
class HttpClient {
  constructor(private readonly base: string) {}
  async request(
    path: string,
    requestId?: string,
    body?: ConsumeCommand | ReturnCommand,
  ): Promise<unknown | null> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(requestId ? { "X-Request-ID": requestId } : {}),
          ...(body ? { "Idempotency-Key": body.operationId } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(3500),
      });
    } catch {
      throw new SalesError(
        "SERVICE_UNAVAILABLE",
        "A required service could not be reached.",
        503,
      );
    }
    if (response.status === 404) return null;
    const value = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    if (!response.ok)
      throw new SalesError(
        value.error?.code ?? "SERVICE_UNAVAILABLE",
        value.error?.message ?? "Required service request failed.",
        response.status >= 500 ? 503 : response.status,
      );
    return value;
  }
}
export class HttpCatalog implements CatalogPort {
  private readonly client: HttpClient;
  constructor(url: string) {
    this.client = new HttpClient(url);
  }
  async menu(id: string, requestId?: string): Promise<CatalogItem> {
    const item = (await this.client.request(
      `/menu-items/${id}`,
      requestId,
    )) as CatalogItem | null;
    if (!item)
      throw new SalesError(
        "MENU_ITEM_UNAVAILABLE",
        "Menu item is unavailable.",
      );
    return item;
  }
  async activeProduct(id: string, requestId?: string): Promise<void> {
    const product = (await this.client.request(
      `/products/${id}`,
      requestId,
    )) as { archivedAt?: string | null } | null;
    if (!product || product.archivedAt)
      throw new SalesError(
        "PRODUCT_ARCHIVED",
        "Recipe ingredient is unavailable for a new sale.",
      );
  }
}
export class HttpInventory implements InventoryPort {
  private readonly client: HttpClient;
  constructor(url: string) {
    this.client = new HttpClient(url);
  }
  private validate(value: unknown, id: string): OperationOutcome {
    const outcome = value as OperationOutcome;
    if (
      !outcome ||
      !["COMMITTED", "REJECTED"].includes(outcome.status) ||
      outcome.id !== id
    )
      throw new SalesError(
        "SERVICE_UNAVAILABLE",
        "Inventory returned an invalid operation outcome.",
        503,
      );
    return outcome;
  }
  async status(id: string, requestId?: string) {
    const value = await this.client.request(
      `/stock-operations/${id}`,
      requestId,
    );
    return value === null ? null : this.validate(value, id);
  }
  async consume(body: ConsumeCommand, requestId?: string) {
    return this.validate(
      await this.client.request(
        "/stock-operations/consume-sale",
        requestId,
        body,
      ),
      body.operationId,
    );
  }
  async returnStock(body: ReturnCommand, requestId?: string) {
    return this.validate(
      await this.client.request(
        "/stock-operations/return-sale",
        requestId,
        body,
      ),
      body.operationId,
    );
  }
}
