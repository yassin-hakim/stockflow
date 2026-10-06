export type StockStatus = 'OUT' | 'LOW' | 'OK';
export type MovementType = 'ADD' | 'REMOVE';

export interface Product {
  id: string;
  name: string;
  unit: string;
  category: string;
  lowStockThreshold: number;
  createdAt: string;
  updatedAt: string;
  sku?: string | null;
  version?: number;
  archivedAt?: string | null;
}

export interface InventoryRecord {
  productId: string;
  quantity: number;
}

export interface InventoryOverview {
  product: Product;
  quantity: number;
  status: StockStatus;
}

export interface StockMovement {
  id: string;
  productId: string;
  type: MovementType;
  quantity: number;
  reason: string;
  createdAt: string;
}

export interface StockChangeResult {
  productId: string;
  quantity: number;
  movement: StockMovement;
}

export interface StockEventV1 {
  schemaVersion: 1;
  eventId: string;
  eventType: 'StockAdded' | 'StockRemoved';
  movementId: string;
  productId: string;
  quantity: number;
  resultingQuantity: number;
  reason: string;
  occurredAt: string;
}

export type ApiErrorCode = 'INVALID_REQUEST' | 'INVALID_QUANTITY' | 'PRODUCT_NOT_FOUND' | 'INVENTORY_NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'STOCK_LIMIT_EXCEEDED' | 'IDEMPOTENCY_CONFLICT' | 'UPSTREAM_UNAVAILABLE' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR';
export interface ApiError {
  error: { code: ApiErrorCode; message: string; requestId: string };
}

export interface Items<T> { items: T[] }

export * from './operations';
