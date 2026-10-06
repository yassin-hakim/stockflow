import { createHash, randomUUID } from "node:crypto";
import {
  SalesError,
  ingredientBundle,
  normalizeCart,
  normalizeRefund,
  priceCart,
  refundAmount,
  type CartLine,
  type RefundRecord,
  type ReturnLine,
  type SaleRecord,
} from "../domain/sale";
import type {
  Attempt,
  CatalogPort,
  CommandRecord,
  InventoryPort,
  OutboxEvent,
  SalesStore,
  SalesTransaction,
  StoredRefund,
} from "./ports";

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function now() {
  return new Date().toISOString();
}
function replay(command: CommandRecord | null, hash: string): boolean {
  if (!command) return false;
  if (command.fingerprint !== hash)
    throw new SalesError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was already used with different input.",
    );
  return true;
}
async function requiredSale(
  tx: Pick<SalesTransaction, "sale">,
  id: string,
): Promise<SaleRecord> {
  const sale = await tx.sale(id);
  if (!sale) throw new SalesError("SALE_NOT_FOUND", "Sale not found.", 404);
  return sale;
}
export class SalesUseCases {
  constructor(
    readonly store: SalesStore,
    readonly catalog: CatalogPort,
    readonly inventory: InventoryPort,
    readonly currency: string,
  ) {}
  private async pricing(
    lines: CartLine[],
    sale?: SaleRecord,
    requestId?: string,
  ) {
    const cart = normalizeCart(lines);
    const items = await Promise.all(
      cart.map((l) => this.catalog.menu(l.menuItemId, requestId)),
    );
    const products = [
      ...new Set(items.flatMap((i) => i.ingredients.map((p) => p.productId))),
    ];
    await Promise.all(
      products.map((p) => this.catalog.activeProduct(p, requestId)),
    );
    return priceCart(
      cart,
      items,
      this.currency,
      (id) => sale?.lines.find((l) => l.menuItemId === id)?.id ?? randomUUID(),
    );
  }
  async create(
    key: string,
    input: { locationId: string; lines: CartLine[] },
    requestId?: string,
  ) {
    const hash = fingerprint({
      kind: "CREATE",
      locationId: input.locationId,
      lines: normalizeCart(input.lines),
    });
    const prior = await this.store.command(key);
    if (replay(prior, hash)) return this.get(prior!.saleId);
    const priced = await this.pricing(input.lines, undefined, requestId);
    const id = randomUUID();
    const time = now();
    return this.store.transaction(async (tx) => {
      const stored = await tx.command(key);
      if (replay(stored, hash)) return requiredSale(tx, stored!.saleId);
      const sale: SaleRecord = {
        id,
        status: "DRAFT",
        locationId: input.locationId,
        ...priced,
        currency: this.currency,
        version: 0,
        tender: null,
        receiptReference: null,
        refundedCounts: {},
        createdAt: time,
        updatedAt: time,
      };
      await tx.saveSale(sale);
      await tx.saveCommand({
        id: key,
        kind: "CREATE",
        fingerprint: hash,
        saleId: id,
      });
      return sale;
    });
  }
  async edit(
    id: string,
    input: { expectedVersion: number; locationId: string; lines: CartLine[] },
    requestId?: string,
  ) {
    const current = await this.get(id);
    const priced = await this.pricing(input.lines, current, requestId);
    return this.store.transaction(async (tx) => {
      const sale = await requiredSale(tx, id);
      if (sale.version !== input.expectedVersion)
        throw new SalesError(
          "VERSION_CONFLICT",
          "Draft changed; refresh before editing.",
        );
      if (!["DRAFT", "REJECTED"].includes(sale.status))
        throw new SalesError(
          "INVALID_SALE_STATE",
          "Only an editable draft can change.",
        );
      Object.assign(sale, priced, {
        locationId: input.locationId,
        status: "DRAFT",
        version: sale.version + 1,
        updatedAt: now(),
        tender: null,
        receiptReference: null,
      });
      delete sale.error;
      delete sale.operationId;
      delete sale.attemptId;
      await tx.saveSale(sale);
      return sale;
    });
  }
  async get(id: string) {
    return requiredSale(this.store, id);
  }
  async checkout(
    id: string,
    key: string,
    input: {
      expectedVersion: number;
      tender: "CASH" | "CARD";
      locationId?: string;
    },
    requestId?: string,
  ) {
    const hash = fingerprint({
      kind: "CHECKOUT",
      saleId: id,
      expectedVersion: input.expectedVersion,
      tender: input.tender,
      locationId: input.locationId ?? null,
    });
    const prior = await this.store.command(key);
    if (replay(prior, hash)) {
      await this.resolveCheckout(prior!.referenceId!, requestId);
      return this.checkoutOutcome(prior!.referenceId!, requestId);
    }
    const draft = await this.get(id);
    if (draft.status !== "DRAFT")
      throw new SalesError(
        draft.status === "CHECKOUT_PENDING"
          ? "OPERATION_PENDING"
          : "INVALID_SALE_STATE",
        "Checkout requires a reviewed draft.",
      );
    if (draft.version !== input.expectedVersion)
      throw new SalesError(
        "VERSION_CONFLICT",
        "Reviewed draft version is stale.",
      );
    if (input.locationId && input.locationId !== draft.locationId)
      throw new SalesError(
        "VERSION_CONFLICT",
        "Consumption location differs from the reviewed draft.",
      );
    const currentPrice = await this.pricing(
      draft.lines.map((l) => ({
        menuItemId: l.menuItemId,
        quantity: l.quantity,
      })),
      draft,
      requestId,
    );
    if (
      fingerprint(currentPrice) !==
      fingerprint({ lines: draft.lines, totalMinor: draft.totalMinor })
    )
      throw new SalesError(
        "PRICE_REVIEW_REQUIRED",
        "Menu or recipe changed. Refresh the draft and review its current price.",
      );
    const attempt = await this.store.transaction(async (tx) => {
      const stored = await tx.command(key);
      if (replay(stored, hash))
        return (await tx.attempt(stored!.referenceId!))!;
      const sale = await requiredSale(tx, id);
      if (sale.version !== input.expectedVersion)
        throw new SalesError(
          "VERSION_CONFLICT",
          "Reviewed draft version is stale.",
        );
      if (sale.status !== "DRAFT")
        throw new SalesError(
          "OPERATION_PENDING",
          "Sale already has an active checkout.",
        );
      const time = now();
      const operationId = randomUUID();
      const record: Attempt = {
        id: key,
        saleId: id,
        status: "CHECKOUT_PENDING",
        createdAt: time,
        updatedAt: time,
        command: {
          operationId,
          locationId: sale.locationId,
          reference: id,
          reason: `Sale ${id}`,
          lines: ingredientBundle(sale.lines),
          allocations: sale.lines.map((l) => ({
            saleLineId: l.id,
            quantity: l.quantity,
            ingredients: l.ingredients.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
            })),
          })),
        },
      };
      Object.assign(sale, {
        status: "CHECKOUT_PENDING",
        tender: input.tender,
        operationId,
        attemptId: key,
        version: sale.version + 1,
        updatedAt: time,
      });
      record.snapshot = structuredClone(sale);
      await tx.saveSale(sale);
      await tx.saveAttempt(record);
      await tx.saveCommand({
        id: key,
        kind: "CHECKOUT",
        fingerprint: hash,
        saleId: id,
        referenceId: key,
      });
      return record;
    });
    await this.resolveCheckout(attempt.id, requestId);
    return this.checkoutOutcome(attempt.id, requestId);
  }
  private async checkoutOutcome(attemptId: string, requestId?: string): Promise<SaleRecord> {
    const attempt = await this.store.attempt(attemptId);
    if (!attempt) throw new SalesError('INVALID_SALE_STATE', 'Checkout attempt is unavailable.');
    if (attempt.result) return structuredClone(attempt.result);
    if (attempt.status === 'CHECKOUT_PENDING' && attempt.snapshot) return structuredClone(attempt.snapshot);
    // Older persisted attempts predate frozen replies. A completed receipt is itself
    // immutable and identifies its original Inventory operation, so it is safe to replay.
    if (attempt.status === 'COMPLETED') {
      const receipt = await this.store.receipt(attempt.saleId);
      if (receipt?.sale.operationId === attempt.command.operationId) return structuredClone(receipt.sale);
    }
    const sale = await this.get(attempt.saleId);
    if (sale.attemptId === attempt.id && sale.operationId === attempt.command.operationId && sale.status === attempt.status) return sale;
    // A legacy rejected attempt may already have been edited/replaced. Never label
    // the replacement cart or a newer receipt as the old command's original reply.
    if (attempt.status === 'REJECTED') {
      const outcome = await this.inventory.status(attempt.command.operationId, requestId);
      if (outcome?.status === 'REJECTED' && outcome.error) throw new SalesError(outcome.error.code, outcome.error.message);
    }
    throw new SalesError('INVALID_SALE_STATE', `Historical checkout is ${attempt.status}; its priced snapshot was not retained by the older schema. Open the current sale separately.`);
  }
  async resolveCheckout(id: string, requestId?: string): Promise<void> {
    const attempt = await this.store.attempt(id);
    if (!attempt || attempt.status !== "CHECKOUT_PENDING") return;
    let outcome;
    try {
      outcome =
        (await this.inventory.status(attempt.command.operationId, requestId)) ??
        (await this.inventory.consume(attempt.command, requestId));
    } catch {
      await this.store.transaction(async tx => {
        const current = await tx.attempt(id);
        if(current?.status === 'CHECKOUT_PENDING'){current.updatedAt = now();await tx.saveAttempt(current);}
      });
      return;
    }
    await this.store.transaction(async (tx) => {
      const current = await tx.attempt(id);
      if (!current || current.status !== "CHECKOUT_PENDING") return;
      const sale = await requiredSale(tx, current.saleId);
      const time = now();
      current.status =
        outcome.status === "COMMITTED" ? "COMPLETED" : "REJECTED";
      current.updatedAt = time;
      sale.status = current.status;
      sale.updatedAt = time;
      sale.version++;
      if (outcome.status === "COMMITTED") {
        sale.receiptReference = `SF-${sale.id.toUpperCase()}`;
        sale.completedAt = time;
        sale.ingredientCostMinor = outcome.currency && outcome.currency!==this.currency ? null : (outcome.costMinor??null);
        await tx.saveReceipt({
          saleId: sale.id,
          reference: sale.receiptReference,
          sale: structuredClone(sale),
          issuedAt: time,
        });
        await tx.saveEvent(
          this.event(sale, "SaleCompleted", current.id, sale.totalMinor, time),
        );
      } else
        sale.error = outcome.error ?? {
          code: "INVALID_SALE_STATE",
          message: "Ingredient consumption was rejected.",
        };
      current.result = structuredClone(sale);
      await tx.saveSale(sale);
      await tx.saveAttempt(current);
    });
  }
  async cancel(id: string, input: { expectedVersion: number }) {
    return this.store.transaction(async (tx) => {
      const sale = await requiredSale(tx, id);
      if (sale.status === "CANCELLED") return sale;
      if (sale.version !== input.expectedVersion)
        throw new SalesError("VERSION_CONFLICT", "Draft changed.");
      if (!["DRAFT", "REJECTED"].includes(sale.status))
        throw new SalesError(
          "INVALID_SALE_STATE",
          "Only an uncompleted draft may be cancelled.",
        );
      sale.status = "CANCELLED";
      sale.version++;
      sale.updatedAt = now();
      await tx.saveSale(sale);
      return sale;
    });
  }
  async refund(
    saleId: string,
    key: string,
    input: {
      lines: ReturnLine[];
      reason: string;
      restock: boolean;
      expectedVersion?: number;
    },
    requestId?: string,
  ) {
    const lines = normalizeRefund(input.lines);
    const reason = input.reason.trim();
    const hash = fingerprint({
      kind: "REFUND",
      saleId,
      lines,
      reason,
      restock: input.restock,
      expectedVersion: input.expectedVersion ?? null,
    });
    const refund = await this.store.transaction(async (tx) => {
      const stored = await tx.command(key);
      if (replay(stored, hash)) return (await tx.refund(stored!.referenceId!))!;
      const sale = await requiredSale(tx, saleId);
      if (
        input.expectedVersion !== undefined &&
        sale.version !== input.expectedVersion
      )
        throw new SalesError(
          "VERSION_CONFLICT",
          "Sale correction state changed.",
        );
      const previous = await tx.refunds(saleId);
      if (!sale.refundedCounts) {
        sale.refundedCounts = {};
        for (const refund of previous.filter((r) => r.status === "COMPLETED"))
          for (const line of refund.lines)
            sale.refundedCounts[line.saleLineId] =
              (sale.refundedCounts[line.saleLineId] ?? 0) + line.quantity;
      }
      const amountMinor = refundAmount(sale, lines, previous);
      const time = now();
      const refund: StoredRefund = {
        id: key,
        saleId,
        status: input.restock ? "REFUND_PENDING" : "COMPLETED",
        lines,
        amountMinor,
        currency: sale.currency,
        reason,
        restock: input.restock,
        createdAt: time,
        updatedAt: time,
      };
      if (input.restock) {
        refund.operationId = randomUUID();
        refund.command = {
          operationId: refund.operationId,
          originalOperationId: sale.operationId!,
          returnedItems: lines,
          reason: `Refund ${refund.id}: ${reason.slice(0, 150)}`,
        };
        sale.pendingRefundId = refund.id;
      }
      sale.version++;
      sale.updatedAt = time;
      await tx.saveRefund(refund);
      await tx.saveSale(sale);
      await tx.saveCommand({
        id: key,
        kind: "REFUND",
        fingerprint: hash,
        saleId,
        referenceId: refund.id,
      });
      if (!input.restock) {
        this.recordRefundedCounts(sale, refund);
        await tx.saveSale(sale);
        await tx.saveEvent(
          this.event(sale, "SaleRefunded", refund.id, amountMinor, time),
        );
      }
      return refund;
    });
    if (refund.status === "REFUND_PENDING")
      await this.resolveRefund(refund.id, requestId);
    return (await this.store.refund(refund.id))!;
  }
  async resolveRefund(id: string, requestId?: string): Promise<void> {
    const refund = await this.store.refund(id);
    if (!refund || refund.status !== "REFUND_PENDING" || !refund.command)
      return;
    let outcome;
    try {
      outcome =
        (await this.inventory.status(refund.command.operationId, requestId)) ??
        (await this.inventory.returnStock(refund.command, requestId));
    } catch {
      await this.store.transaction(async tx => {
        const current = await tx.refund(id);
        if(current?.status === 'REFUND_PENDING'){current.updatedAt = now();await tx.saveRefund(current);}
      });
      return;
    }
    await this.store.transaction(async (tx) => {
      const current = await tx.refund(id);
      if (!current || current.status !== "REFUND_PENDING") return;
      const sale = await requiredSale(tx, current.saleId);
      const time = now();
      current.status =
        outcome.status === "COMMITTED" ? "COMPLETED" : "REJECTED";
      current.updatedAt = time;
      if(outcome.status==='COMMITTED') current.ingredientCostMinor=outcome.currency && outcome.currency!==this.currency ? null : (outcome.costMinor??null);
      if (outcome.status === "REJECTED")
        current.error = outcome.error ?? {
          code: "INVALID_SALE_STATE",
          message: "Stock return rejected.",
        };
      delete sale.pendingRefundId;
      sale.version++;
      sale.updatedAt = time;
      if (current.status === "COMPLETED")
        this.recordRefundedCounts(sale, current);
      await tx.saveRefund(current);
      await tx.saveSale(sale);
      if (current.status === "COMPLETED")
        await tx.saveEvent(
          this.event(
            sale,
            "SaleRefunded",
            current.id,
            current.amountMinor,
            time,
          ),
        );
    });
  }
  private recordRefundedCounts(sale: SaleRecord, refund: RefundRecord) {
    sale.refundedCounts ??= {};
    for (const line of refund.lines)
      sale.refundedCounts[line.saleLineId] =
        (sale.refundedCounts[line.saleLineId] ?? 0) + line.quantity;
  }
  private event(
    sale: SaleRecord,
    eventType: "SaleCompleted" | "SaleRefunded",
    referenceId: string,
    amountMinor: number,
    time: string,
  ): OutboxEvent {
    const eventId = randomUUID();
    return {
      eventId,
      subject:
        eventType === "SaleCompleted"
          ? "sales.sale.completed"
          : "sales.sale.refunded",
      payload: {
        schemaVersion: 1,
        eventId,
        eventType,
        saleId: sale.id,
        referenceId,
        locationId: sale.locationId,
        amountMinor,
        currency: sale.currency,
        ...(sale.receiptReference ? { receiptReference: sale.receiptReference } : {}),
        occurredAt: time,
      },
      createdAt: time,
      publishedAt: null,
      attempts: 0,
      nextAttemptAt: time,
    };
  }
  async recover(): Promise<void> {
    const pending = await this.store.pending(25);
    for (const attempt of pending.attempts)
      await this.resolveCheckout(attempt.id);
    for (const refund of pending.refunds) await this.resolveRefund(refund.id);
  }
}
