import { describe, expect, it } from "vitest";
import { createProduct, InvalidProductError } from "../src/domain/product";
import {
  CreateProduct,
  GetProduct,
  ListProducts,
  ProductNotFoundError,
} from "../src/application/product-use-cases";
import type { ProductRepository } from "../src/application/product-repository";
import type { Product } from "../src/domain/product";

describe("product domain", () => {
  it("normalizes fields and keeps the threshold in milliunits", () => {
    const product = createProduct({
      name: " Arabica Coffee ",
      unit: " kg ",
      category: " Coffee ",
      lowStockThresholdMillis: 5000,
    });
    expect(product.name).toBe("Arabica Coffee");
    expect(product.unit).toBe("kg");
    expect(product.lowStockThresholdMillis).toBe(5000);
  });
  it("rejects invalid fields", () => {
    expect(() =>
      createProduct({
        name: "",
        unit: "kg",
        category: "Coffee",
        lowStockThresholdMillis: 0,
      }),
    ).toThrowError(InvalidProductError);
    expect(() =>
      createProduct({
        name: "Coffee",
        unit: "kg",
        category: "Coffee",
        lowStockThresholdMillis: -1,
      }),
    ).toThrowError(InvalidProductError);
  });
});

describe("product use cases", () => {
  it("creates, lists and retrieves through the repository port", async () => {
    const products = new Map<string, Product>();
    const repository: ProductRepository = {
      insert: async (product) => {
        products.set(product.id, product);
      },
      findAll: async () => [...products.values()],
      findById: async (id) => products.get(id) ?? null,
    };
    const created = await new CreateProduct(repository).execute({
      name: "Coffee",
      unit: "kg",
      category: "Beans",
      lowStockThresholdMillis: 0,
    });
    expect(products.get(created.id)).toEqual(created);
    expect(await new ListProducts(repository).execute()).toEqual([created]);
    expect(await new GetProduct(repository).execute(created.id)).toEqual(
      created,
    );
    await expect(new GetProduct(repository).execute("missing")).rejects.toThrow(
      ProductNotFoundError,
    );
  });
});
