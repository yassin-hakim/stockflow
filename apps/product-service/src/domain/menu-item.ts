import { randomUUID } from 'node:crypto';
import { isUuid, MAX_QUANTITY_MILLIS } from '@stockflow/primitives';
import type { Product } from './product';

export class MenuError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

export interface IngredientInput { productId: string; quantityMillis: number }
export interface IngredientSnapshot { productId: string; name: string; unit: string; quantityMillis: number }
export interface MenuInput { name: string; category: string; priceMinor: number; currency: string; ingredients: IngredientInput[] }
export interface MenuItem {
  id: string; name: string; category: string; priceMinor: number; currency: string;
  version: number; recipeRevision: number; ingredients: IngredientSnapshot[];
  archivedAt: string | null; createdAt: string; updatedAt: string;
}

// This release only supports currencies with exactly two decimal places.
const CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY', 'HKD', 'SGD', 'AED', 'SAR', 'QAR', 'EGP', 'LBP', 'TRY', 'INR', 'ZAR', 'BRL', 'MXN', 'SEK', 'NOK', 'DKK', 'PLN']);
export function configuredCurrency(value: string): string {
  if (!CURRENCIES.has(value)) throw new MenuError('INVALID_CURRENCY', 'Currency must be a supported two-decimal ISO currency.');
  return value;
}

function text(value: string, max: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new MenuError('INVALID_MENU_ITEM', `Invalid menu ${field}.`);
  return value.trim();
}

export function validateMenuInput(input: MenuInput, currency: string): MenuInput {
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0) throw new MenuError('INVALID_PRICE', 'Price must be a nonnegative safe integer in minor units.');
  if (input.currency !== configuredCurrency(currency)) throw new MenuError('CURRENCY_MISMATCH', `Menu prices must use ${currency}.`);
  if (!Array.isArray(input.ingredients) || !input.ingredients.length || input.ingredients.length > 100) throw new MenuError('INVALID_RECIPE', 'A recipe must contain 1–100 ingredient lines.');
  for (const ingredient of input.ingredients) {
    if (!ingredient || !isUuid(ingredient.productId) || !Number.isSafeInteger(ingredient.quantityMillis) || ingredient.quantityMillis <= 0 || ingredient.quantityMillis > MAX_QUANTITY_MILLIS) throw new MenuError('INVALID_RECIPE', 'Ingredients require valid product IDs and positive base-unit quantities with at most three decimals.');
  }
  return { ...input, name: text(input.name, 100, 'name'), category: text(input.category, 80, 'category') };
}

/** Combine before persistence so every downstream consumer sees one allocation per product. */
export function recipeSnapshot(ingredients: IngredientInput[], products: Product[]): IngredientSnapshot[] {
  const catalog = new Map(products.map(product => [product.id, product]));
  const combined = new Map<string, IngredientSnapshot>();
  for (const ingredient of ingredients) {
    const product = catalog.get(ingredient.productId);
    if (!product) throw new MenuError('INGREDIENT_NOT_FOUND', `Ingredient ${ingredient.productId} was not found.`, 404);
    if (product.archivedAt) throw new MenuError('INGREDIENT_ARCHIVED', `${product.name} is archived. Choose an active ingredient.`, 409);
    const total = (combined.get(product.id)?.quantityMillis ?? 0) + ingredient.quantityMillis;
    if (!Number.isSafeInteger(total) || total > MAX_QUANTITY_MILLIS) throw new MenuError('INVALID_RECIPE', `Combined ${product.name} quantity exceeds the supported limit.`);
    combined.set(product.id, { productId: product.id, name: product.name, unit: product.unit, quantityMillis: total });
  }
  return [...combined.values()];
}

export function createMenuItem(input: MenuInput, products: Product[], currency: string, now = new Date()): MenuItem {
  const validated = validateMenuInput(input, currency);
  const timestamp = now.toISOString();
  return { ...validated, id: randomUUID(), version: 0, recipeRevision: 1, ingredients: recipeSnapshot(validated.ingredients, products), archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
}

export function publishMenuItem(current: MenuItem, input: MenuInput, products: Product[], currency: string, expectedVersion: number, now = new Date()): MenuItem {
  assertVersion(current, expectedVersion);
  if (current.archivedAt) throw new MenuError('MENU_ITEM_ARCHIVED', 'Archived menu items cannot be edited or published.', 409);
  const validated = validateMenuInput(input, currency);
  return { ...current, ...validated, ingredients: recipeSnapshot(validated.ingredients, products), version: nextVersion(current.version), recipeRevision: nextVersion(current.recipeRevision), updatedAt: now.toISOString() };
}

export function archiveMenuItem(current: MenuItem, expectedVersion: number, now = new Date()): MenuItem {
  if (current.archivedAt) return current;
  assertVersion(current, expectedVersion);
  const timestamp = now.toISOString();
  return { ...current, version: nextVersion(current.version), archivedAt: timestamp, updatedAt: timestamp };
}

function nextVersion(value: number): number {
  if (!Number.isSafeInteger(value + 1)) throw new MenuError('VERSION_LIMIT', 'Catalog version limit reached.', 409);
  return value + 1;
}
function assertVersion(current: MenuItem, expectedVersion: number): void {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new MenuError('INVALID_VERSION', 'Invalid expectedVersion.');
  if (current.version !== expectedVersion) throw new MenuError('VERSION_CONFLICT', 'This menu item changed. Refresh before saving.', 409);
}
