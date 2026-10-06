import { describe, expect, it, vi } from "vitest";
import { InventoryManagement, type InventoryManagementRepository } from "../src/application/inventory-management";
import { StockOperations } from "../src/application/operations";
import { ManagementController, countDto } from "../src/presentation/management-controller";

const productId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";

describe("Inventory management boundary contracts", () => {
  it("accepts zero policy values and converts 0.001 precision without float quantities", async () => {
    const saveRule = vi.fn(async (_product: string, _location: string, lowMillis: number, targetMillis: number) =>
      ({ productId, locationId, lowMillis, targetMillis, version: 0 }));
    const controller = new ManagementController({ saveRule } as unknown as InventoryManagement);
    expect(await controller.saveRule({ productId, locationId, lowStockThreshold: 0, targetQuantity: 0, expectedVersion: null })).toEqual({
      productId, locationId, lowStockThreshold: 0, targetQuantity: 0, version: 0,
    });
    await controller.saveRule({ productId, locationId, lowStockThreshold: 0.001, targetQuantity: 0.003, expectedVersion: null });
    expect(saveRule).toHaveBeenLastCalledWith(productId, locationId, 1, 3, null);
    for (const invalid of [-0.001, 0.0001, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(controller.saveRule({ productId, locationId, lowStockThreshold: invalid, targetQuantity: 1, expectedVersion: null })).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
      await expect(controller.saveRule({ productId, locationId, lowStockThreshold: 0, targetQuantity: invalid, expectedVersion: null })).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    }
    expect(saveRule).toHaveBeenCalledTimes(2);
  });

  it("propagates either required replenishment source failure instead of projecting zero", async () => {
    const failure = new Error("Mongo source unavailable");
    const base = {
      locationExists: async () => true,
      rules: async () => [{ productId, locationId, lowMillis: 1, targetMillis: 3, version: 0 }],
      allBalances: async () => [],
    };
    for (const source of ["rules", "allBalances"] as const) {
      const repository = { ...base, [source]: async () => { throw failure; } } as unknown as InventoryManagementRepository;
      const management = new InventoryManagement(repository, { get: async (id) => ({ id }) }, {} as StockOperations);
      await expect(management.replenishment(locationId)).rejects.toBe(failure);
    }
  });

  it("returns server differences while distinguishing blank entries from explicit zero", () => {
    const result = countDto({
      id: productId, locationId, status: "DRAFT", reason: "Physical count", version: 0,
      createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z",
      lines: [
        { productId, recordedMillis: 1, expectedVersion: 0, countedMillis: null },
        { productId: locationId, recordedMillis: 3, expectedVersion: 1, countedMillis: 0 },
      ],
    });
    expect(result.lines[0]).toMatchObject({ recordedQuantity: 0.001, countedQuantity: null, differenceQuantity: null });
    expect(result.lines[1]).toMatchObject({ recordedQuantity: 0.003, countedQuantity: 0, differenceQuantity: -0.003 });
    expect(result.lines[0]).not.toHaveProperty("recordedMillis");
  });
});
