import { MongoServerError, type Collection, type MongoClient } from "mongodb";
import type { ProductManagementRepository } from "../application/product-repository";
import { CatalogError, type Product } from "../domain/product";

interface ProductDocument {
  _id: string;
  name: string;
  unit: string;
  category: string;
  lowStockThresholdMillis: number;
  createdAt: string;
  updatedAt: string;
  version?: number;
  sku?: string | null;
  archivedAt?: string | null;
}

export class MongoProductRepository implements ProductManagementRepository {
  private readonly collection: Collection<ProductDocument>;

  constructor(client: MongoClient) {
    this.collection = client.db().collection<ProductDocument>("products");
  }

  async setup(): Promise<void> {
    await this.collection.createIndex({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string' } } });
  }

  async save(product: Product, expectedVersion: number): Promise<boolean> {
    try {
      const version = expectedVersion === 0 ? { $or: [{ version: 0 }, { version: { $exists: false } }] } : { version: expectedVersion };
      const result = await this.collection.replaceOne({ _id: product.id, ...version }, withoutId(product));
      return result.matchedCount === 1;
    } catch (error) { throw skuError(error); }
  }

  async insert(product: Product): Promise<void> {
    try { await this.collection.insertOne({ _id: product.id, ...withoutId(product) }); }
    catch (error) { throw skuError(error); }
  }

  async findAll(): Promise<Product[]> {
    const records = await this.collection.find().toArray();
    return records.map(toProduct);
  }

  async findById(id: string): Promise<Product | null> {
    const record = await this.collection.findOne({ _id: id });
    return record ? toProduct(record) : null;
  }
}

function withoutId(product: Product): Omit<Product, "id"> {
  const { id: _id, ...fields } = product;
  return fields;
}

function toProduct(record: ProductDocument): Product {
  const { _id: id, ...fields } = record;
  return { id, ...fields, version: fields.version ?? 0, sku: fields.sku ?? null, archivedAt: fields.archivedAt ?? null };
}

function skuError(error: unknown): unknown {
  if (error instanceof MongoServerError && error.code === 11000 && error.keyPattern?.sku) return new CatalogError('SKU_CONFLICT', 'This SKU is already assigned to another product.');
  return error;
}
