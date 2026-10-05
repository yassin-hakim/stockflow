import { describe, expect, it } from "vitest";
import type { Product } from "@stockflow/contracts";
import { overview, projectInventory } from "../src/projection";

const product = (id: string, name: string, threshold: number): Product => ({
  id,
  name,
  unit: "kg",
  category: "Coffee",
  lowStockThreshold: threshold,
  createdAt: "",
  updatedAt: "",
});

describe("BFF inventory projection", () => {
  it("keeps all products, sorts names and projects absent balances as OUT", () => {
    const rows = projectInventory(
      [product("2", "zeta", 0), product("1", "Arabica", 5)],
      [{ productId: "2", quantity: 3 }],
    );
    expect(
      rows.map((row) => [row.product.name, row.quantity, row.status]),
    ).toEqual([
      ["Arabica", 0, "OUT"],
      ["zeta", 3, "OK"],
    ]);
  });
  it("classifies positive threshold boundaries", () => {
    const coffee = product("1", "Coffee", 5);
    expect(overview(coffee, 5).status).toBe("LOW");
    expect(overview(coffee, 5.001).status).toBe("OK");
    expect(overview(coffee, 0).status).toBe("OUT");
    expect(overview(product("2", "Other", 0), 0.001).status).toBe("OK");
  });
});
