import { describe, expect, it } from 'vitest';
import { archiveProduct, CatalogError, createProduct, editProduct } from '../src/domain/product';
import { ManageProduct } from '../src/application/product-use-cases';
import type { ProductManagementRepository } from '../src/application/product-repository';

const input = { name: 'Arabica Coffee', unit: 'kg', category: 'Coffee', lowStockThresholdMillis: 5000, sku: ' beans-01 ' };

describe('product management', () => {
  it('normalizes identity, preserves the unit/history and versions changes', () => {
    const original = createProduct(input);
    expect(original.sku).toBe('BEANS-01');
    const edited = editProduct(original, { ...input, name: ' Espresso Beans ', lowStockThresholdMillis: 7000 }, 0);
    expect(edited).toMatchObject({ id: original.id, name: 'Espresso Beans', unit: 'kg', version: 1, createdAt: original.createdAt });
    const archived = archiveProduct(edited, 1);
    expect(archived.archivedAt).toBeTruthy();
    expect(archiveProduct(archived, 1)).toEqual(archived);
    expect(() => editProduct(archived, input, 2)).toThrow(CatalogError);
  });
  it('rejects stale changes without changing the original state', () => {
    const original = createProduct(input);
    expect(() => editProduct(original, input, 2)).toThrowError('Refresh');
    expect(original.version).toBe(0);
    expect(original.archivedAt).toBeNull();
  });
  it('handles an adapter race as a version conflict', async () => {
    const original = createProduct(input);
    const repository: ProductManagementRepository = {
      findById: async () => original, findAll: async () => [original], insert: async () => {}, save: async () => false,
    };
    await expect(new ManageProduct(repository).edit(original.id, input, 0)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
  it('rejects malformed SKUs and unsafe thresholds', () => {
    expect(() => createProduct({ ...input, sku: 'bad sku!' })).toThrow();
    expect(() => editProduct(createProduct(input), { ...input, lowStockThresholdMillis: 1.5 }, 0)).toThrow();
  });
});
