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
}

export class InvalidProductError extends Error {}

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
  };
}
