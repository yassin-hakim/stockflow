import type { HistoryFilter } from "./inventory-management";
import { randomUUID } from "node:crypto";
import { OperationError } from "../domain/operations";
import type {
  Balance,
  OperationResult,
  OperationMovement,
} from "../domain/operations";

export interface WarehouseLocation {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface WarehouseRepository {
  locations(): Promise<WarehouseLocation[]>;
  location(id: string): Promise<WarehouseLocation | null>;
  saveLocation(
    location: WarehouseLocation,
    expectedVersion: number | null,
  ): Promise<boolean>;
  allBalances(locationId?: string): Promise<Balance[]>;
  operation(id: string): Promise<OperationResult | null>;
  operations(
    kind: string | undefined,
    cursor: string | undefined,
    limit: number,
    filter?: HistoryFilter,
  ): Promise<{ items: OperationResult[]; nextCursor: string | null }>;
  movements(
    productId: string,
    locationId: string | undefined,
    cursor: string | undefined,
    limit: number,
    filter?: HistoryFilter,
  ): Promise<{ items: OperationMovement[]; nextCursor: string | null }>;
  report(
    filter: HistoryFilter,
    cursor: string | undefined,
    limit: number,
  ): Promise<{
    items: OperationMovement[];
    nextCursor: string | null;
    filters: HistoryFilter;
    products: InventoryProductFacts[];
  }>;
}
export interface InventoryProductFacts {
  productId: string;
  addedQuantity: number;
  removedQuantity: number;
  consumedQuantity: number;
  wasteQuantity: number;
  transferInQuantity: number;
  transferOutQuantity: number;
  countVariance: number;
}

export class Warehouses {
  constructor(private readonly repository: WarehouseRepository) {}
  locations() {
    return this.repository.locations();
  }
  async location(id: string): Promise<WarehouseLocation> {
    const location = await this.repository.location(id);
    if (!location)
      throw new OperationError(
        "LOCATION_NOT_FOUND",
        "Storage location not found.",
      );
    return location;
  }
  async create(name: string): Promise<WarehouseLocation> {
    const timestamp = new Date().toISOString();
    const location = {
      id: randomUUID(),
      name: validName(name),
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.saveLocation(location, null);
    return location;
  }
  async rename(
    id: string,
    name: string,
    expectedVersion: number,
  ): Promise<WarehouseLocation> {
    const existing = await this.location(id);
    if (existing.version !== expectedVersion)
      throw new OperationError(
        "VERSION_CONFLICT",
        "This location changed. Refresh before saving.",
      );
    const location = {
      ...existing,
      name: validName(name),
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (!(await this.repository.saveLocation(location, expectedVersion)))
      throw new OperationError(
        "VERSION_CONFLICT",
        "This location changed. Refresh before saving.",
      );
    return location;
  }
  async balances(locationId?: string): Promise<Balance[]> {
    if (locationId) await this.location(locationId);
    return this.repository.allBalances(locationId);
  }
  async operation(id: string): Promise<OperationResult> {
    const operation = await this.repository.operation(id);
    if (!operation)
      throw new OperationError(
        "OPERATION_NOT_FOUND",
        "Stock operation not recorded. Retry the same request identity if its outcome is uncertain.",
      );
    return operation;
  }
  operations(
    kind?: string,
    cursor?: string,
    limit = 50,
    filter?: HistoryFilter,
  ) {
    return this.repository.operations(kind, cursor, limit, filter);
  }
  movements(
    productId: string,
    locationId?: string,
    cursor?: string,
    limit = 50,
    filter?: HistoryFilter,
  ) {
    return this.repository.movements(
      productId,
      locationId,
      cursor,
      limit,
      filter,
    );
  }
  report(filter: HistoryFilter, cursor: string | undefined, limit: number) {
    return this.repository.report(filter, cursor, limit);
  }
}
function validName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80)
    throw new OperationError(
      "INVALID_REQUEST",
      "Enter a location name of 1–80 characters.",
    );
  return name;
}
