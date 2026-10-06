import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import { createProduct } from '../src/domain/product';
import { archiveMenuItem, createMenuItem, publishMenuItem } from '../src/domain/menu-item';
import { MongoMenuRepository } from '../src/infrastructure/mongo-menu-repository';

// Explicit opt-in. Every run uses a new disposable DB and never touches runtime databases.
const uri = process.env.PRODUCT_TEST_MONGO_URI;
describe.skipIf(!uri)('menu real Mongo transaction/concurrency', () => {
  let client: MongoClient, repository: MongoMenuRepository;
  const databaseName = `stockflow_product_menu_test_${randomUUID().replaceAll('-', '')}`;
  const coffee = createProduct({ name: 'Coffee', unit: 'kg', category: 'Coffee', lowStockThresholdMillis: 0 });
  const input = { name: 'Latte', category: 'Coffee', priceMinor: 400, currency: 'USD', ingredients: [{ productId: coffee.id, quantityMillis: 18 }] };
  beforeAll(async () => {
    client = await MongoClient.connect(uri!, { dbName: databaseName, serverSelectionTimeoutMS: 3000 });
    repository = new MongoMenuRepository(client);
    await repository.setup();
  });
  afterAll(async () => {
    if (client) {
      if (client.db().databaseName !== databaseName || !databaseName.startsWith('stockflow_product_menu_test_')) throw new Error('Unsafe test cleanup target.');
      await client.db().dropDatabase();
      await client.close();
    }
  });
  it('atomically persists the current snapshot and immutable revisions', async () => {
    const old = createMenuItem(input, [coffee], 'USD');
    await repository.insert(old);
    const next = publishMenuItem(old, { ...input, priceMinor: 500 }, [coffee], 'USD', 0);
    expect(await repository.publish(next, 0)).toBe(true);
    expect(await repository.findById(old.id)).toEqual(next);
    expect(await repository.findRevision(old.id, 1)).toEqual(old);
    expect(await repository.findRevision(old.id, 2)).toEqual(next);
    expect(await repository.archive(archiveMenuItem(next, 1), 1)).toBe(true);
    expect(await repository.findRevision(old.id, 2)).toEqual(next);
  });
  it('rolls back current changes when immutable revision persistence fails', async () => {
    const old = createMenuItem(input, [coffee], 'USD');
    await repository.insert(old);
    const next = publishMenuItem(old, { ...input, priceMinor: 500 }, [coffee], 'USD', 0);
    await client.db().collection('recipe_revisions').insertOne({ _id: `${old.id}:2` as never, menuItemId: old.id, revision: 2, snapshot: next });
    await expect(repository.publish(next, 0)).rejects.toMatchObject({ code: 11000 });
    expect(await repository.findById(old.id)).toEqual(old);
    expect(await repository.findRevision(old.id, 1)).toEqual(old);
  });
  it('allows one concurrent publication from the same reviewed version', async () => {
    const old = createMenuItem(input, [coffee], 'USD');
    await repository.insert(old);
    const a = publishMenuItem(old, { ...input, priceMinor: 500 }, [coffee], 'USD', 0);
    const b = publishMenuItem(old, { ...input, priceMinor: 600 }, [coffee], 'USD', 0);
    const results = await Promise.all([repository.publish(a, 0), repository.publish(b, 0)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const current = await repository.findById(old.id);
    expect(current?.recipeRevision).toBe(2);
    expect(await repository.findRevision(old.id, 2)).toEqual(current);
    expect(await client.db().collection('recipe_revisions').countDocuments({ menuItemId: old.id })).toBe(2);
  });
});
