import { describe, expect, it } from "vitest";
import { isUuid, quantityMillis } from "../src";

describe("quantity codec", () => {
  it.each([
    0.001, 0.1, 1.001, 134217728.001, 536870912.001, 999999999.999,
    1_000_000_000,
  ])("round-trips valid thousandths %s", (value) => {
    const millis = quantityMillis(value);
    expect(millis).not.toBeNull();
    expect(millis! / 1000).toBe(value);
  });
  it.each([
    0,
    -1,
    0.000000001,
    0.001000009,
    1.0001,
    134217728.0001,
    536870912.0001,
    1_000_000_000.001,
    NaN,
    Infinity,
    "1",
    null,
  ])("rejects invalid stock quantity %s", (value) => {
    expect(quantityMillis(value)).toBeNull();
  });
  it("allows zero only when requested", () =>
    expect(quantityMillis(0, true)).toBe(0));
  it("accepts parsed exponent and trailing-zero spellings", () => {
    expect(quantityMillis(JSON.parse("1e-3"))).toBe(1);
    expect(quantityMillis(JSON.parse("1.0000"))).toBe(1000);
  });
  it("rejects UUID arrays and objects", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(isUuid(id)).toBe(true);
    expect(isUuid([id])).toBe(false);
    expect(isUuid({ toString: () => id })).toBe(false);
  });
});
