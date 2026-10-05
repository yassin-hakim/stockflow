import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import type { Product } from '@stockflow/contracts';

const id = process.argv[2];
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Usage: npm run verify:product-reload -- <product UUID>');

async function main(): Promise<void> {
  const client = await MongoClient.connect(process.env.PRODUCT_MONGO_URI ?? 'mongodb://localhost:27017/stockflow_product?replicaSet=rs0&directConnection=true');
  try {
    const document = await client.db().collection('products').findOne({ _id: id });
    const response = await fetch(`${process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:3001'}/products/${id}`);
    assert.equal(response.status, 200);
    const product = await response.json() as Product;
    assert(document);
    assert.deepEqual(product, {
      id,
      name: document.name,
      unit: document.unit,
      category: document.category,
      lowStockThreshold: Number(document.lowStockThresholdMillis) / 1000,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    });
    process.stdout.write(`Verified Product ${id} reloads unchanged after service restart.\n`);
  } finally { await client.close(); }
}
void main();
