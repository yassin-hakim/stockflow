import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MAX_QUANTITY_MILLIS } from "@stockflow/primitives";
import {
  normalizeOperation,
  planOperation,
  returnLines,
  type OperationCommand,
  type Balance,
} from "../src/domain/operations";

const productId = randomUUID(),
  other = randomUUID(),
  source = randomUUID(),
  destination = randomUUID();
const balance = (
  product: string,
  locationId: string,
  quantityMillis: number,
): Balance => ({
  productId: product,
  locationId,
  quantityMillis,
  version: 1,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
});
function command(
  kind: OperationCommand["kind"],
  lines = [{ productId, quantityMillis: 5000 }],
): OperationCommand {
  return {
    id: randomUUID(),
    kind,
    locationId: source,
    destinationLocationId: kind === "TRANSFER" ? destination : undefined,
    lines,
    ...(kind === "SALE"
      ? {
          allocations: [
            { saleLineId: randomUUID(), quantity: 1, ingredients: lines },
          ],
        }
      : {}),
    reason: "Kitchen service",
    reference: "TEST-1006",
  };
}

describe("compound stock domain", () => {
  it("moves stock in paired changes without changing restaurant totals", () => {
    const result = planOperation(normalizeOperation(command("TRANSFER")), [
      balance(productId, source, 20000),
    ]);
    expect(
      result.balances.reduce((sum, item) => sum + item.quantityMillis, 0),
    ).toBe(20000);
    expect(result.movements.map((item) => item.type).sort()).toEqual([
      "ADD",
      "REMOVE",
    ]);
    expect(new Set(result.movements.map((item) => item.operationId)).size).toBe(
      1,
    );
  });
  it("rejects an entire bundle when one ingredient is insufficient", () => {
    const before = [
      balance(productId, source, 5000),
      balance(other, source, 100),
    ];
    expect(() =>
      planOperation(
        normalizeOperation(
          command("SALE", [
            { productId, quantityMillis: 54 },
            { productId: other, quantityMillis: 600 },
          ]),
        ),
        before,
      ),
    ).toThrow("Insufficient");
    expect(before.map((item) => item.quantityMillis)).toEqual([5000, 100]);
  });
  it("rejects a full destination before accepting the transfer", () => {
    expect(() =>
      planOperation(normalizeOperation(command("TRANSFER")), [
        balance(productId, source, 20000),
        balance(productId, destination, MAX_QUANTITY_MILLIS),
      ]),
    ).toThrow("stock limit");
  });
  it("combines repeated ingredients using checked integer arithmetic", () => {
    const normalized = normalizeOperation(
      command("SALE", [
        { productId, quantityMillis: 18 },
        { productId, quantityMillis: 36 },
      ]),
    );
    expect(normalized.lines).toEqual([{ productId, quantityMillis: 54 }]);
    expect(
      planOperation(normalized, [balance(productId, source, 5000)]).balances[0]
        .quantityMillis,
    ).toBe(4946);
  });
  it("rejects stale counts and finalizes unchanged counts without a stock event", () => {
    const input = {
      ...command("COUNT"),
      expectedBalances: [{ productId, version: 0 }],
    };
    expect(() =>
      planOperation(input, [balance(productId, source, 5000)]),
    ).toThrow("Stock changed");
    const result = planOperation(
      { ...input, expectedBalances: [{ productId, version: 1 }] },
      [balance(productId, source, 5000)],
    );
    expect(result.movements).toHaveLength(0);
    expect(result.balances[0].version).toBe(2);
  });
  it("checks consumption against immutable per-item allocations and derives precise returns", () => {
    const sold = {
      ...command("SALE", [
        { productId, quantityMillis: 54 },
        { productId: other, quantityMillis: 600 },
      ]),
      allocations: [
        {
          saleLineId: source,
          quantity: 3,
          ingredients: [
            { productId, quantityMillis: 18 },
            { productId: other, quantityMillis: 200 },
          ],
        },
      ],
    };
    expect(normalizeOperation(sold).lines).toHaveLength(2);
    expect(returnLines(sold, [{ saleLineId: source, quantity: 1 }])).toEqual([
      { productId, quantityMillis: 18 },
      { productId: other, quantityMillis: 200 },
    ]);
    expect(() =>
      normalizeOperation({
        ...sold,
        lines: [{ productId, quantityMillis: 18 }],
      }),
    ).toThrow("do not match");
    expect(() =>
      returnLines(sold, [{ saleLineId: source, quantity: 4 }]),
    ).toThrow("exceed");
    expect(() =>
      returnLines(sold, [
        { saleLineId: source, quantity: 1 },
        { saleLineId: source, quantity: 1 },
      ]),
    ).toThrow("exceed");
  });
  it("distinguishes an absent zero balance from a newly created zero balance in count snapshots", () => {
    const input = {
      ...command("COUNT", [{ productId, quantityMillis: 0 }]),
      expectedBalances: [{ productId, version: null }],
    };
    expect(planOperation(input, []).movements).toHaveLength(0);
    expect(() =>
      planOperation(input, [{ ...balance(productId, source, 0), version: 0 }]),
    ).toThrow("Stock changed");
  });
  it("rejects identical transfer locations and zero sales amounts", () => {
    expect(() =>
      normalizeOperation({
        ...command("TRANSFER"),
        destinationLocationId: source,
      }),
    ).toThrow();
    expect(() =>
      normalizeOperation(command("SALE", [{ productId, quantityMillis: 0 }])),
    ).toThrow();
  });
});
