import { createProduct, type Product } from '../domain/product';
import type { ProductRepository } from './product-repository';

export class ProductNotFoundError extends Error {}

export class CreateProduct {
  constructor(private readonly repository: ProductRepository) {}

  async execute(input: { name: string; unit: string; category: string; lowStockThresholdMillis: number }): Promise<Product> {
    const product = createProduct(input);
    await this.repository.insert(product);
    return product;
  }
}

export class ListProducts {
  constructor(private readonly repository: ProductRepository) {}
  execute(): Promise<Product[]> { return this.repository.findAll(); }
}

export class GetProduct {
  constructor(private readonly repository: ProductRepository) {}
  async execute(id: string): Promise<Product> {
    const product = await this.repository.findById(id);
    if (!product) throw new ProductNotFoundError('Product not found.');
    return product;
  }
}
