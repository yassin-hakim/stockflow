import { archiveProduct, CatalogError, createProduct, editProduct, type Product, type ProductEdit } from "../domain/product";
import type { ProductRepository, ProductManagementRepository } from "./product-repository";

export class ProductNotFoundError extends Error {}

export class CreateProduct {
  constructor(private readonly repository: ProductRepository) {}

  async execute(input: {
    name: string;
    unit: string;
    category: string;
    lowStockThresholdMillis: number;
    sku?: string | null;
  }): Promise<Product> {
    const product = createProduct(input);
    await this.repository.insert(product);
    return product;
  }
}

export class ManageProduct {
  constructor(private readonly repository: ProductManagementRepository) {}
  private async find(id: string): Promise<Product> {
    const product = await this.repository.findById(id);
    if (!product) throw new ProductNotFoundError('Product not found.');
    return product;
  }
  async edit(id: string, input: ProductEdit, expectedVersion: number): Promise<Product> {
    const updated = editProduct(await this.find(id), input, expectedVersion);
    if (!(await this.repository.save(updated, expectedVersion))) throw new CatalogError('VERSION_CONFLICT', 'This product changed. Refresh before saving.');
    return updated;
  }
  async archive(id: string, expectedVersion: number): Promise<Product> {
    const product = await this.find(id);
    if (product.archivedAt) return product;
    const updated = archiveProduct(product, expectedVersion);
    if (!(await this.repository.save(updated, expectedVersion))) throw new CatalogError('VERSION_CONFLICT', 'This product changed. Refresh before archiving.');
    return updated;
  }
}

export class ListProducts {
  constructor(private readonly repository: ProductRepository) {}
  execute(): Promise<Product[]> {
    return this.repository.findAll();
  }
}

export class GetProduct {
  constructor(private readonly repository: ProductRepository) {}
  async execute(id: string): Promise<Product> {
    const product = await this.repository.findById(id);
    if (!product) throw new ProductNotFoundError("Product not found.");
    return product;
  }
}
