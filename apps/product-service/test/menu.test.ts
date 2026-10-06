import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MAX_QUANTITY_MILLIS } from '@stockflow/primitives';
import { createProduct, type Product } from '../src/domain/product';
import { archiveMenuItem, configuredCurrency, createMenuItem, publishMenuItem, type MenuInput, type MenuItem } from '../src/domain/menu-item';
import { MenuCatalog } from '../src/application/menu-use-cases';
import type { MenuRepository } from '../src/application/menu-repository';
import type { ProductRepository } from '../src/application/product-repository';
import { MenuController, menuDto, parseMenu } from '../src/presentation/menu-controller';

const coffee = createProduct({ name: 'Arabica Coffee', unit: 'kg', category: 'Coffee', lowStockThresholdMillis: 0 });
const milk = createProduct({ name: 'Milk', unit: 'L', category: 'Dairy', lowStockThresholdMillis: 0 });
const input: MenuInput = { name: ' Latte ', category: ' Coffee ', priceMinor: 400, currency: 'USD', ingredients: [{ productId: coffee.id, quantityMillis: 18 }, { productId: milk.id, quantityMillis: 200 }] };

function fixture(products: Product[] = [coffee, milk]) {
  const items = new Map<string, MenuItem>(), revisions = new Map<string, MenuItem>();
  const repository: MenuRepository = {
    insert: vi.fn(async item => { items.set(item.id, structuredClone(item)); revisions.set(`${item.id}:${item.recipeRevision}`, structuredClone(item)); }),
    findAll: async () => [...items.values()].map(value => structuredClone(value)),
    findById: async id => items.has(id) ? structuredClone(items.get(id)!) : null,
    findRevision: async (id, revision) => revisions.has(`${id}:${revision}`) ? structuredClone(revisions.get(`${id}:${revision}`)!) : null,
    publish: vi.fn(async (item, version) => {
      if (items.get(item.id)?.version !== version) return false;
      items.set(item.id, structuredClone(item)); revisions.set(`${item.id}:${item.recipeRevision}`, structuredClone(item)); return true;
    }),
    archive: vi.fn(async (item, version) => { if (items.get(item.id)?.version !== version) return false; items.set(item.id, structuredClone(item)); return true; }),
  };
  const catalog: ProductRepository = { insert: async () => {}, findAll: async () => products, findById: vi.fn(async id => products.find(product => product.id === id) ?? null) };
  return { service: new MenuCatalog(repository, catalog), repository, catalog, items, revisions };
}

describe('menu recipe invariants', () => {
  it('snapshots base units and preserves exact 18/200 milliunit latte allocations', () => {
    const item = createMenuItem(input, [coffee, milk], 'USD');
    expect(item).toMatchObject({ name: 'Latte', category: 'Coffee', priceMinor: 400, currency: 'USD', version: 0, recipeRevision: 1 });
    expect(item.ingredients).toEqual([{ productId: coffee.id, name: 'Arabica Coffee', unit: 'kg', quantityMillis: 18 }, { productId: milk.id, name: 'Milk', unit: 'L', quantityMillis: 200 }]);
    expect(item.ingredients.map(line => line.quantityMillis * 3)).toEqual([54, 600]);
    expect(menuDto(item).ingredients.map(line => line.quantity)).toEqual([0.018, 0.2]);
  });
  it('combines repeated ingredient lines using checked integers', () => {
    const item = createMenuItem({ ...input, ingredients: [{ productId: coffee.id, quantityMillis: 10 }, { productId: coffee.id, quantityMillis: 8 }, { productId: milk.id, quantityMillis: 200 }] }, [coffee, milk], 'USD');
    expect(item.ingredients).toHaveLength(2);
    expect(item.ingredients[0].quantityMillis).toBe(18);
    expect(() => createMenuItem({ ...input, ingredients: [{ productId: coffee.id, quantityMillis: MAX_QUANTITY_MILLIS }, { productId: coffee.id, quantityMillis: 1 }] }, [coffee], 'USD')).toThrow('exceeds');
  });
  it.each([0, -1, 0.5, NaN, Infinity, MAX_QUANTITY_MILLIS + 1])('rejects invalid ingredient milliunits %s', quantityMillis => {
    expect(() => createMenuItem({ ...input, ingredients: [{ productId: coffee.id, quantityMillis }] }, [coffee], 'USD')).toThrow();
  });
  it('rejects unknown or archived ingredients without creating a usable recipe', () => {
    expect(() => createMenuItem(input, [coffee], 'USD')).toThrow('not found');
    expect(() => createMenuItem(input, [coffee, { ...milk, archivedAt: new Date().toISOString() }], 'USD')).toThrow('archived');
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects invalid minor-unit money %s', priceMinor => {
    expect(() => createMenuItem({ ...input, priceMinor }, [coffee, milk], 'USD')).toThrow('Price');
  });
  it('allows free items and enforces one configured two-decimal currency', () => {
    expect(createMenuItem({ ...input, priceMinor: 0 }, [coffee, milk], 'USD').priceMinor).toBe(0);
    expect(() => createMenuItem({ ...input, currency: 'EUR' }, [coffee, milk], 'USD')).toThrow('USD');
    expect(() => configuredCurrency('JPY')).toThrow('two-decimal');
    expect(() => configuredCurrency('KWD')).toThrow('two-decimal');
    expect(() => configuredCurrency('usd')).toThrow();
  });
  it('publishes new immutable snapshots with original identity/creation time preserved', () => {
    const old = createMenuItem(input, [coffee, milk], 'USD');
    const next = publishMenuItem(old, { ...input, name: 'Latte large', priceMinor: 500, ingredients: [{ productId: coffee.id, quantityMillis: 20 }] }, [{ ...coffee, name: 'New coffee label' }], 'USD', 0);
    expect(next).toMatchObject({ id: old.id, createdAt: old.createdAt, priceMinor: 500, version: 1, recipeRevision: 2 });
    expect(old.ingredients).toHaveLength(2);
    expect(old.ingredients[0].name).toBe('Arabica Coffee');
    expect(old.priceMinor).toBe(400);
    expect(next.ingredients[0].name).toBe('New coffee label');
    expect(() => publishMenuItem(next, input, [coffee, milk], 'USD', 0)).toThrow('Refresh');
  });
  it('archives without deleting recipe history and rejects later publishing', () => {
    const old = createMenuItem(input, [coffee, milk], 'USD');
    const archived = archiveMenuItem(old, 0);
    expect(archived).toMatchObject({ version: 1, recipeRevision: 1, ingredients: old.ingredients });
    expect(archiveMenuItem(archived, 0)).toBe(archived);
    expect(() => publishMenuItem(archived, input, [coffee, milk], 'USD', 1)).toThrow('Archived');
  });
});

describe('menu application ports and history', () => {
  it('persists original revisions separately from current edits/archive', async () => {
    const { service } = fixture();
    const old = await service.create(input);
    const next = await service.publish(old.id, { ...input, priceMinor: 600 }, 0);
    await service.archive(old.id, 1);
    expect(await service.revision(old.id, 1)).toEqual(old);
    expect(await service.revision(old.id, 2)).toEqual(next);
    expect((await service.get(old.id)).archivedAt).toBeTruthy();
    expect(await service.list()).toHaveLength(1);
  });
  it('does not write invalid recipes or look up duplicate ingredients repeatedly', async () => {
    const { service, repository, catalog } = fixture([coffee]);
    await expect(service.create(input)).rejects.toMatchObject({ code: 'INGREDIENT_NOT_FOUND' });
    expect(repository.insert).not.toHaveBeenCalled();
    await service.create({ ...input, ingredients: [{ productId: coffee.id, quantityMillis: 8 }, { productId: coffee.id, quantityMillis: 10 }] });
    expect(catalog.findById).toHaveBeenCalledTimes(3); // two first attempt, one distinct ID second attempt
  });
  it('rejects lost optimistic-lock writes without reporting the candidate revision', async () => {
    const { service, repository } = fixture();
    const old = await service.create(input);
    vi.mocked(repository.publish).mockResolvedValue(false);
    await expect(service.publish(old.id, input, 0)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await service.get(old.id)).recipeRevision).toBe(1);
    vi.mocked(repository.archive).mockResolvedValue(false);
    await expect(service.archive(old.id, 0)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
  it('has stable not-found errors for current items and historical revisions', async () => {
    const { service } = fixture();
    await expect(service.get(randomUUID())).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND', status: 404 });
    await expect(service.revision(randomUUID(), 1)).rejects.toMatchObject({ code: 'RECIPE_REVISION_NOT_FOUND', status: 404 });
  });
});

describe('menu HTTP boundary', () => {
  const body = { name: 'Latte', category: 'Coffee', priceMinor: 400, ingredients: [{ productId: coffee.id, quantity: 0.018 }, { productId: milk.id, quantity: 0.2 }] };
  it('accepts base-unit quantities and defaults only the configured currency', () => {
    expect(parseMenu(body, 'USD').input).toEqual({ ...input, name: 'Latte', category: 'Coffee' });
    expect(parseMenu({ ...body, expectedVersion: 0 }, 'USD', true).expectedVersion).toBe(0);
  });
  it.each([0, -1, 0.0001, '0.018', NaN, Infinity])('rejects malformed base-unit quantity %s', quantity => {
    expect(() => parseMenu({ ...body, ingredients: [{ productId: coffee.id, quantity }] }, 'USD')).toThrow();
  });
  it('rejects caller-authored labels/units, unknown fields, fractional prices and absent expectedVersion', () => {
    expect(() => parseMenu({ ...body, ingredients: [{ productId: coffee.id, quantity: 0.018, unit: 'g' }] }, 'USD')).toThrow();
    expect(() => parseMenu({ ...body, price: 4 }, 'USD')).toThrow();
    expect(() => parseMenu({ ...body, priceMinor: 400.5 }, 'USD')).toThrow();
    expect(() => parseMenu(body, 'USD', true)).toThrow();
  });
  it('exposes create/edit/publish/archive/current/historical DTO flows', async () => {
    const { service } = fixture();
    const controller = new MenuController(service);
    const created = await controller.create(body);
    expect(created.ingredients[0]).toMatchObject({ unit: 'kg', quantity: 0.018 });
    const edited = await controller.edit(created.id, { ...body, priceMinor: 450, expectedVersion: 0 });
    expect(edited.recipeRevision).toBe(2);
    const published = await controller.publish(created.id, { ...body, expectedVersion: 1 });
    expect(published.recipeRevision).toBe(3);
    expect(await controller.revision(created.id, '1')).toEqual(created);
    expect(await controller.list()).toEqual({ items: [published], currency: 'USD' });
    expect((await controller.archive(created.id, { expectedVersion: 2 })).archivedAt).toBeTruthy();
    await expect(controller.get('bad-id')).rejects.toThrow('ID');
    await expect(controller.revision(created.id, '1.0')).rejects.toThrow('revision');
  });
});
