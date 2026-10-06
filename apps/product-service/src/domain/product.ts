import { randomUUID } from "node:crypto";
import { MAX_QUANTITY_MILLIS } from "@stockflow/primitives";

export interface Product {
  id: string;
  name: string;
  unit: string;
  category: string;
  lowStockThresholdMillis: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  sku: string | null;
  archivedAt: string | null;
}

export class InvalidProductError extends Error {}

export class CatalogError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function normalizeSku(value?: string | null): string | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const sku = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(sku)) throw new InvalidProductError('SKU must contain up to 50 letters, digits, dots, underscores or hyphens.');
  return sku;
}

function threshold(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_QUANTITY_MILLIS) throw new InvalidProductError('Invalid low-stock threshold.');
  return value;
}

export interface ProductEdit { name: string; category: string; lowStockThresholdMillis: number; sku?: string | null }

export function editProduct(product: Product, input: ProductEdit, expectedVersion: number, now = new Date()): Product {
  if (product.version !== expectedVersion) throw new CatalogError('VERSION_CONFLICT', 'This product changed. Refresh before saving.');
  if (product.archivedAt) throw new CatalogError('PRODUCT_ARCHIVED', 'Archived products cannot be edited.');
  return { ...product, name: requiredText(input.name, 100, 'name'), category: requiredText(input.category, 80, 'category'), lowStockThresholdMillis: threshold(input.lowStockThresholdMillis), sku: normalizeSku(input.sku), version: product.version + 1, updatedAt: now.toISOString() };
}

export function archiveProduct(product: Product, expectedVersion: number, now = new Date()): Product {
  if (product.archivedAt) return product;
  if (product.version !== expectedVersion) throw new CatalogError('VERSION_CONFLICT', 'This product changed. Refresh before archiving.');
  return { ...product, archivedAt: now.toISOString(), updatedAt: now.toISOString(), version: product.version + 1 };
}

function requiredText(value: string, maxLength: number, field: string): string {
  const text = value.trim();
  if (!text || text.length > maxLength)
    throw new InvalidProductError(`Invalid ${field}.`);
  return text;
}

export function createProduct(
  input: {
    name: string;
    unit: string;
    category: string;
    lowStockThresholdMillis: number;
    sku?: string | null;
  },
  now = new Date(),
): Product {
  if (
    !Number.isSafeInteger(input.lowStockThresholdMillis) ||
    input.lowStockThresholdMillis < 0 ||
    input.lowStockThresholdMillis > MAX_QUANTITY_MILLIS
  ) {
    throw new InvalidProductError("Invalid low-stock threshold.");
  }
  const timestamp = now.toISOString();
  return {
    id: randomUUID(),
    name: requiredText(input.name, 100, "name"),
    unit: requiredText(input.unit, 20, "unit"),
    category: requiredText(input.category, 80, "category"),
    lowStockThresholdMillis: input.lowStockThresholdMillis,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 0,
    sku: normalizeSku(input.sku),
    archivedAt: null,
  };
}
