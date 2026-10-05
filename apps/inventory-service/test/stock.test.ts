import { describe, expect, it, vi } from "vitest";
import {
  changeStock,
  StockError,
  toMillis,
  type InventoryItemState,
  type StockCommand,
} from "../src/domain/stock";
import {
  StockUseCases,
  type ProductCatalog,
  type StockStore,
  type PersistedStockChange,
} from "../src/application/stock-use-cases";
import type {
  Items,
  InventoryRecord,
  StockChangeResult,
  StockMovement,
} from "@stockflow/contracts";

const productId = "11111111-1111-4111-8111-111111111111";
function command(
  type: "ADD" | "REMOVE",
  amount: number,
  key = crypto.randomUUID(),
): StockCommand {
  return {
    productId,
    type,
    quantityMillis: toMillis(amount),
    reason: "Demo",
    idempotencyKey: key,
  };
}

describe("stock domain", () => {
  it("keeps exact milliunit arithmetic through add, remove and rejection", () => {
    const added = changeStock(null, command("ADD", 50));
    expect(added.item.quantityMillis).toBe(50_000);
    expect(added.event.eventType).toBe("StockAdded");
    const removed = changeStock(added.item, command("REMOVE", 10));
    expect(removed.item.quantityMillis).toBe(40_000);
    expect(removed.event.eventType).toBe("StockRemoved");
    expect(() => changeStock(removed.item, command("REMOVE", 50))).toThrowError(
      StockError,
    );
    expect(removed.item.quantityMillis).toBe(40_000);
  });
  it("accepts thousandths and rejects invalid quantities", () => {
    expect(toMillis(1.001)).toBe(1001);
    expect(toMillis(0.001)).toBe(1);
    for (const value of [0, -1, 1.0001, 1_000_000_000.001, "5"])
      expect(() => toMillis(value)).toThrowError(StockError);
  });
  it("rejects stock above the maximum balance", () => {
    const item: InventoryItemState = {
      productId,
      quantityMillis: 1_000_000_000_000,
      version: 1,
      createdAt: "",
      updatedAt: "",
    };
    expect(() => changeStock(item, command("ADD", 0.001))).toThrowError(
      StockError,
    );
  });
  it("enforces positive quantity inside the domain even if an adapter is bypassed", () => {
    expect(() =>
      changeStock(null, { ...command("ADD", 1), quantityMillis: 0 }),
    ).toThrowError(StockError);
  });
});

class FakeStore implements StockStore {
  item: InventoryItemState | null = null;
  commits = 0;
  movementsMade: StockMovement[] = [];
  commands = new Map<
    string,
    { command: StockCommand; result: StockChangeResult }
  >();
  async find() {
    return this.item;
  }
  async findCommand(key: string) {
    return this.commands.get(key) ?? null;
  }
  async commit(
    command: StockCommand,
    _before: InventoryItemState | null,
    change: PersistedStockChange,
  ) {
    const movement: StockMovement = {
      id: change.movement.id,
      productId,
      type: command.type,
      quantity: change.movement.quantityMillis / 1000,
      reason: change.movement.reason,
      createdAt: change.movement.createdAt,
    };
    this.commits++;
    this.item = change.item;
    this.movementsMade.push(movement);
    this.commands.set(command.idempotencyKey, {
      command,
      result: {
        productId,
        quantity: change.item.quantityMillis / 1000,
        movement,
      },
    });
    return true;
  }
  async list(): Promise<Items<InventoryRecord>> {
    return { items: [] };
  }
  async movements(): Promise<Items<StockMovement>> {
    return { items: this.movementsMade };
  }
}

describe("stock application", () => {
  it("commits once for a replay and never commits a rejected removal", async () => {
    const store = new FakeStore();
    const products: ProductCatalog = { exists: async () => true };
    const use = new StockUseCases(store, products);
    const add = command("ADD", 50);
    const first = await use.change(add);
    expect(await use.change(add)).toEqual(first);
    expect(store.commits).toBe(1);
    await use.change(command("REMOVE", 10));
    await expect(use.change(command("REMOVE", 50))).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });
    expect(store.commits).toBe(2);
    expect(store.movementsMade).toHaveLength(2);
    expect(store.item?.quantityMillis).toBe(40_000);
  });
  it("rejects reusing an idempotency key with a changed command", async () => {
    const use = new StockUseCases(new FakeStore(), {
      exists: async () => true,
    });
    const first = command("ADD", 1);
    await use.change(first);
    await expect(
      use.change({ ...first, quantityMillis: 2000 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("returns a concurrently committed removal instead of rejecting the newer empty balance", async () => {
    const store = new FakeStore();
    const use = new StockUseCases(store, { exists: async () => true });
    await use.change(command("ADD", 1));
    const remove = command("REMOVE", 1);
    const committed = await use.change(remove);
    // The first lookup saw no command; the subsequent read saw its committed balance.
    vi.spyOn(store, "findCommand").mockResolvedValueOnce(null);
    expect(await use.change(remove)).toEqual(committed);
    expect(store.commits).toBe(2);
  });
  it("returns a concurrently committed addition instead of rejecting the newer maximum balance", async () => {
    const store = new FakeStore();
    const use = new StockUseCases(store, { exists: async () => true });
    const add = command("ADD", 1_000_000_000);
    const committed = await use.change(add);
    vi.spyOn(store, "findCommand").mockResolvedValueOnce(null);
    expect(await use.change(add)).toEqual(committed);
    expect(store.commits).toBe(1);
  });
  it("checks for a committed command after the last write retry", async () => {
    const store = new FakeStore();
    const use = new StockUseCases(store, { exists: async () => true });
    const add = command("ADD", 1);
    const committed = await use.change(add);
    store.item = null;
    vi.spyOn(store, "findCommand")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.spyOn(store, "commit").mockResolvedValue(false);
    expect(await use.change(add)).toEqual(committed);
  });
});
