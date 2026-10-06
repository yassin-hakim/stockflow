import {
  OperationError,
  type Balance,
  type OperationResult,
} from "../domain/operations";
import { StockOperations, type OperationCatalog } from "./operations";

export interface SupplierRecord {
  id: string;
  name: string;
  note: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface CountRecord {
  id: string;
  locationId: string;
  status: "DRAFT" | "APPLIED" | "CANCELLED";
  lines: {
    productId: string;
    recordedMillis: number;
    expectedVersion: number | null;
    countedMillis: number | null;
  }[];
  reason: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  operationId?: string;
}
export interface RuleRecord {
  productId: string;
  locationId: string;
  lowMillis: number;
  targetMillis: number;
  version: number;
}
export interface HistoryFilter {
  locationId?: string;
  productId?: string;
  cause?: string;
  from?: string;
  to?: string;
}
export interface InventoryManagementRepository {
  locationExists(id: string): Promise<boolean>;
  balances(
    identities: { productId: string; locationId: string }[],
  ): Promise<Balance[]>;
  suppliers(): Promise<SupplierRecord[]>;
  supplier(id: string): Promise<SupplierRecord | null>;
  saveSupplier(
    value: SupplierRecord,
    expected: number | null,
  ): Promise<boolean>;
  count(id: string): Promise<CountRecord | null>;
  counts(
    filter: HistoryFilter,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: CountRecord[]; nextCursor: string | null }>;
  createCount(value: CountRecord, fingerprint: string): Promise<CountRecord>;
  updateCount(value: CountRecord, expected: number): Promise<boolean>;
  findCommand(
    key: string,
  ): Promise<{ fingerprint: string; result: OperationResult } | null>;
  rules(locationId?: string): Promise<RuleRecord[]>;
  saveRule(value: RuleRecord, expected: number | null): Promise<boolean>;
  allBalances(locationId?: string): Promise<Balance[]>;
}
export class InventoryManagement {
  constructor(
    private readonly repository: InventoryManagementRepository,
    private readonly catalog: OperationCatalog,
    private readonly operations: StockOperations,
  ) {}
  suppliers() {
    return this.repository.suppliers();
  }
  async saveSupplier(
    id: string,
    name: string,
    note: string,
    expected: number | null,
  ) {
    const now = new Date().toISOString(),
      existing = await this.repository.supplier(id);
    if (expected !== null && (!existing || existing.version !== expected))
      throw new OperationError(
        "VERSION_CONFLICT",
        "Supplier changed. Refresh before saving.",
      );
    const value = {
      id,
      name,
      note,
      version: expected === null ? 0 : expected + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (!(await this.repository.saveSupplier(value, expected)))
      throw new OperationError(
        "VERSION_CONFLICT",
        "Supplier changed. Refresh before saving.",
      );
    return value;
  }
  async count(id: string) {
    const value = await this.repository.count(id);
    if (!value)
      throw new OperationError("COUNT_NOT_FOUND", "Count session not found.");
    return value;
  }
  counts(filter: HistoryFilter, cursor: string | undefined, limit: number) {
    return this.repository.counts(filter, cursor, limit);
  }
  async createCount(
    id: string,
    locationId: string,
    productIds: string[],
    reason: string,
  ) {
    if (
      !productIds.length ||
      productIds.length > 100 ||
      new Set(productIds).size !== productIds.length
    )
      throw new OperationError(
        "INVALID_REQUEST",
        "Choose 1–100 distinct products.",
      );
    const sorted = [...productIds].sort(),
      fingerprint = JSON.stringify([locationId, sorted, reason]);
    const existing = await this.repository.count(id);
    if (existing) return this.repository.createCount(existing, fingerprint);
    if (!(await this.repository.locationExists(locationId)))
      throw new OperationError(
        "LOCATION_NOT_FOUND",
        "Storage location not found.",
      );
    for (const productId of sorted) await this.catalog.get(productId);
    const balances = await this.repository.balances(
        sorted.map((productId) => ({ productId, locationId })),
      ),
      now = new Date().toISOString();
    return this.repository.createCount(
      {
        id,
        locationId,
        status: "DRAFT",
        lines: sorted.map((productId) => {
          const balance = balances.find((item) => item.productId === productId);
          return {
            productId,
            recordedMillis: balance?.quantityMillis ?? 0,
            expectedVersion: balance?.version ?? null,
            countedMillis: null,
          };
        }),
        reason,
        version: 0,
        createdAt: now,
        updatedAt: now,
      },
      fingerprint,
    );
  }
  async editCount(
    id: string,
    expected: number,
    entries: { productId: string; countedMillis: number | null }[],
    reason?: string,
  ) {
    const current = await this.count(id);
    if (current.status !== "DRAFT" || current.version !== expected)
      throw new OperationError(
        "VERSION_CONFLICT",
        "This count changed. Refresh before editing.",
      );
    if (
      new Set(entries.map((item) => item.productId)).size !== entries.length ||
      entries.some(
        (item) =>
          !current.lines.some((line) => line.productId === item.productId),
      )
    )
      throw new OperationError(
        "INVALID_REQUEST",
        "Count entries must belong to this session.",
      );
    const value = {
      ...current,
      lines: current.lines.map((line) => {
        const entered = entries.find(
          (item) => item.productId === line.productId,
        );
        return entered
          ? { ...line, countedMillis: entered.countedMillis }
          : line;
      }),
      reason: reason ?? current.reason,
      version: expected + 1,
      updatedAt: new Date().toISOString(),
    };
    if (!(await this.repository.updateCount(value, expected)))
      throw new OperationError(
        "VERSION_CONFLICT",
        "This count changed. Refresh before editing.",
      );
    return value;
  }
  async applyCount(id: string, expected: number, key: string) {
    const replay = await this.repository.findCommand(key);
    if (replay) {
      if (
        replay.result.command?.countId !== id ||
        replay.result.command.countVersion !== expected
      )
        throw new OperationError(
          "IDEMPOTENCY_CONFLICT",
          "This request belongs to a different count.",
        );
      return replay.result;
    }
    const count = await this.count(id);
    if (count.status !== "DRAFT" || count.version !== expected)
      throw new OperationError(
        "VERSION_CONFLICT",
        "This count changed or was already applied.",
      );
    if (count.lines.some((line) => line.countedMillis === null))
      throw new OperationError(
        "INVALID_REQUEST",
        "Enter every counted quantity, including explicit zero, before applying.",
      );
    return this.operations.execute({
      id: key,
      kind: "COUNT",
      locationId: count.locationId,
      reason: count.reason,
      reference: count.id,
      countId: count.id,
      countVersion: expected,
      lines: count.lines.map((line) => ({
        productId: line.productId,
        quantityMillis: line.countedMillis!,
      })),
      expectedBalances: count.lines.map((line) => ({
        productId: line.productId,
        version: line.expectedVersion,
      })),
    });
  }
  async cancelCount(id: string, expected: number) {
    const current = await this.count(id);
    if (current.status === "CANCELLED" && current.version === expected + 1)
      return current;
    if (current.status !== "DRAFT" || current.version !== expected)
      throw new OperationError(
        "VERSION_CONFLICT",
        "This count changed or was already applied.",
      );
    const value = {
      ...current,
      status: "CANCELLED" as const,
      version: expected + 1,
      updatedAt: new Date().toISOString(),
    };
    if (!(await this.repository.updateCount(value, expected)))
      throw new OperationError(
        "VERSION_CONFLICT",
        "This count changed. Refresh before cancelling.",
      );
    return value;
  }
  rules(locationId?: string) {
    return this.repository.rules(locationId);
  }
  async saveRule(
    productId: string,
    locationId: string,
    lowMillis: number,
    targetMillis: number,
    expected: number | null,
  ) {
    if (targetMillis < lowMillis)
      throw new OperationError(
        "INVALID_QUANTITY",
        "Target must be at least the low-stock threshold.",
      );
    if (!(await this.repository.locationExists(locationId)))
      throw new OperationError(
        "LOCATION_NOT_FOUND",
        "Storage location not found.",
      );
    await this.catalog.get(productId);
    const value = {
      productId,
      locationId,
      lowMillis,
      targetMillis,
      version: expected === null ? 0 : expected + 1,
    };
    if (!(await this.repository.saveRule(value, expected)))
      throw new OperationError(
        "VERSION_CONFLICT",
        "This policy changed. Refresh before saving.",
      );
    return value;
  }
  async replenishment(locationId?: string) {
    if (locationId && !(await this.repository.locationExists(locationId)))
      throw new OperationError(
        "LOCATION_NOT_FOUND",
        "Storage location not found.",
      );
    const [rules, balances] = await Promise.all([
      this.repository.rules(locationId),
      this.repository.allBalances(locationId),
    ]);
    const identities = new Map(
      [...balances, ...rules].map((item) => [
        `${item.productId}:${item.locationId}`,
        item,
      ]),
    );
    return [...identities.values()].map((identity) => {
      const balance = balances.find(
          (item) =>
            item.productId === identity.productId &&
            item.locationId === identity.locationId,
        ),
        rule = rules.find(
          (item) =>
            item.productId === identity.productId &&
            item.locationId === identity.locationId,
        ),
        quantity = balance?.quantityMillis ?? 0;
      return {
        productId: identity.productId,
        locationId: identity.locationId,
        quantity: quantity / 1000,
        lowStockThreshold: rule ? rule.lowMillis / 1000 : null,
        targetQuantity: rule ? rule.targetMillis / 1000 : null,
        suggestedQuantity: rule
          ? (quantity <= rule.lowMillis
              ? Math.max(0, rule.targetMillis - quantity)
              : 0) / 1000
          : null,
        version: rule?.version ?? null,
      };
    });
  }
}
