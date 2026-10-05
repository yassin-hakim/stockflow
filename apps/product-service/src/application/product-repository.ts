import type { Product } from "../domain/product";

export interface ProductRepository {
  insert(product: Product): Promise<void>;
  findAll(): Promise<Product[]>;
  findById(id: string): Promise<Product | null>;
}
