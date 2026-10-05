import { describe, expect, it } from "vitest";
import { productBody, stockBody } from "../src/validation";
import { parseThreshold } from "../../product-service/src/presentation/product-controller";

describe("HTTP quantity validation", () => {
  it.each([134217728.001, 536870912.001, 999999999.999])(
    "accepts large valid thousandths %s at both boundaries",
    (quantity) => {
      expect(stockBody({ quantity, reason: "Delivery" })).toEqual({
        quantity,
        reason: "Delivery",
      });
      expect(
        productBody({
          name: "Coffee",
          unit: "kg",
          category: "Coffee",
          lowStockThreshold: quantity,
        }),
      ).toMatchObject({ lowStockThreshold: quantity });
      expect(parseThreshold(quantity)).toBe(Math.round(quantity * 1000));
    },
  );
  it.each([0.001000009, 134217728.0001, 536870912.0001])(
    "rejects finer precision %s",
    (quantity) => {
      expect(() => stockBody({ quantity, reason: "Delivery" })).toThrow();
      expect(() => parseThreshold(quantity)).toThrow();
    },
  );
});
