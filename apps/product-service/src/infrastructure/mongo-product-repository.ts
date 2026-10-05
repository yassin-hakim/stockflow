import type { Collection, MongoClient } from "mongodb";
import type { ProductRepository } from "../application/product-repository";
import type { Product } from "../domain/product";

interface ProductDocument {
  _id: string;
  name: string;
  unit: string;
  category: string;
  lowStockThresholdMillis: number;
  createdAt: string;
  updatedAt: string;
}

export class MongoProductRepository implements ProductRepository {
  private readonly collection: Collection<ProductDocument>;

  constructor(client: MongoClient) {
    this.collection = client.db().collection<ProductDocument>("products");
  }

  async insert(product: Product): Promise<void> {
    await this.collection.insertOne({ _id: product.id, ...withoutId(product) });
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
  return { id, ...fields };
}
