import { saleLabel } from '../shared/record-labels';
import { ReadableText } from '../shared/readable-text';
import { Component, inject, signal } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Refund, RefundLine, Sale } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
import { PendingSales, type PendingSaleCommand } from './pending-sales';
@Component({
  selector: 'app-sale-refund',
  imports: [ReadableText, ReactiveFormsModule, RouterLink, CurrencyPipe, DecimalPipe],
  templateUrl: './sale-refund.html',
  styleUrl: './sales.css',
})
export class SaleRefund {
  readonly label = saleLabel;
  ingredientNames(){return this.sale()?.lines.flatMap(line=>line.ingredients) ?? [];}
  private readonly api = inject(BffApi);
  private readonly storage = inject(PendingSales);
  private readonly fb = inject(FormBuilder);
  private id = '';
  readonly sale = signal<Sale | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly storageError = signal('');
  readonly pending = signal<PendingSaleCommand | null>(null);
  readonly result = signal<Refund | null>(null);
  readonly quantities = signal<Partial<Record<string, number>>>({});
  readonly form = this.fb.nonNullable.group({
    reason: ['', [Validators.required, Validators.maxLength(500)]],
    restock: [false],
    confirmed: [false, Validators.requiredTrue],
  });
  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((params) => {
        this.id = params.get('id') ?? '';
        void this.load();
      });
  }
  async load() {
    this.loading.set(true);
    this.error.set('');
    this.storageError.set('');
    try {
      const sale = await this.api.getSale(this.id);
      this.sale.set(sale);
      try {
        const saved = this.storage.get();
        this.pending.set(saved);
        if (saved?.kind === 'REFUND' && saved.saleId === sale.id) {
          this.form.patchValue({
            reason: String(saved.body['reason']),
            restock: saved.body['restock'] === true,
            confirmed: true,
          });
          const quantities: Record<string, number> = {};
          for (const line of saved.body['lines'] as RefundLine[])
            quantities[line.saleLineId] = line.quantity;
          this.quantities.set(quantities);
        }
      } catch (error) {
        this.storageError.set(error instanceof Error ? error.message : 'Recovery unavailable.');
      }
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.loading.set(false);
    }
  }
  blocked() {
    return (
      this.busy() ||
      !!this.pending() ||
      !!this.storageError() ||
      !!this.sale()?.refunds?.some((r) => r.status === 'REFUND_PENDING')
    );
  }
  remaining(lineId: string) {
    const sale = this.sale();
    const sold = sale?.lines.find((l) => l.id === lineId)?.quantity ?? 0;
    const refunded = (sale?.refunds ?? [])
      .filter((r) => r.status !== 'REJECTED')
      .flatMap((r) => r.lines)
      .filter((l) => l.saleLineId === lineId)
      .reduce((n, l) => n + l.quantity, 0);
    return sold - refunded;
  }
  change(id: string, value: string) {
    this.quantities.update((previous) => ({ ...previous, [id]: Number(value) }));
    this.form.controls.confirmed.setValue(false);
  }
  selected() {
    return Object.entries(this.quantities())
      .filter(([, quantity]) => typeof quantity === 'number' && quantity > 0)
      .map(([saleLineId, quantity]) => ({ saleLineId, quantity: quantity! }));
  }
  estimated() {
    return this.selected().reduce(
      (sum, line) =>
        sum +
        (this.sale()?.lines.find((l) => l.id === line.saleLineId)?.priceMinor ?? 0) * line.quantity,
      0,
    );
  }
  returnPreview() {
    const totals = new Map<string, { name: string; unit: string; quantity: number }>();
    for (const line of this.selected()) {
      const original = this.sale()?.lines.find((l) => l.id === line.saleLineId);
      for (const ingredient of original?.ingredients ?? []) {
        const prior = totals.get(ingredient.productId);
        totals.set(ingredient.productId, {
          name: ingredient.name,
          unit: ingredient.unit,
          quantity:
            ((prior?.quantity ?? 0) * 1000 +
              Math.round(ingredient.quantity * 1000) * line.quantity) /
            1000,
        });
      }
    }
    return [...totals.values()];
  }
  async submit() {
    if (this.blocked() || this.sale()?.status !== 'COMPLETED') return;
    this.error.set('');
    this.form.markAllAsTouched();
    const lines = this.selected(),
      value = this.form.getRawValue();
    if (
      this.form.invalid ||
      !value.reason.trim() ||
      !lines.length ||
      lines.some(
        (l) =>
          !Number.isSafeInteger(l.quantity) ||
          l.quantity < 1 ||
          l.quantity > this.remaining(l.saleLineId),
      )
    ) {
      this.error.set(
        'Select eligible whole item quantities, provide a reason and confirm the correction.',
      );
      return;
    }
    const command: PendingSaleCommand = {
      kind: 'REFUND',
      saleId: this.id,
      key: crypto.randomUUID(),
      body: {
        lines,
        reason: value.reason.trim(),
        restock: value.restock,
        expectedVersion: this.sale()!.version,
      },
    };
    this.busy.set(true);
    try {
      try{this.storage.save(command);}catch(error){this.storageError.set(error instanceof Error?error.message:'Correction recovery storage is unavailable.');throw error;}
      this.pending.set(command);
      await this.send(command);
    } catch (error) {
      const described = describeError(error);
      this.error.set(described.message);
      if (
        [
          'REFUND_LIMIT_EXCEEDED',
          'VERSION_CONFLICT',
          'INVALID_SALE_STATE',
          'INVALID_REQUEST',
          'OPERATION_PENDING',
        ].includes(described.code)
      ) {
        this.storage.clear(command.key);
        this.pending.set(null);
        await this.load();
      }
    } finally {
      this.busy.set(false);
    }
  }
  private async send(command: PendingSaleCommand) {
    const result = await this.api.refundSale(
      this.id,
      command.body as unknown as {
        lines: RefundLine[];
        reason: string;
        restock: boolean;
        expectedVersion: number;
      },
      command.key,
    );
    this.result.set(result);
    if (result.status !== 'REFUND_PENDING') {
      this.storage.clear(command.key);
      this.pending.set(null);
      this.sale.set(await this.api.getSale(this.id));
      if (result.status === 'COMPLETED') {
        this.quantities.set({});
        this.form.reset({ reason: '', restock: false, confirmed: false });
      } else
        this.error.set(result.error?.message ?? 'Stock return rejected. No refund was recorded.');
    }
  }
  async resolve() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const pending = this.pending();
      if (pending?.kind === 'REFUND' && pending.saleId === this.id) {
        try {
          const refund = await this.api.getRefund(this.id, pending.key);
          this.result.set(refund);
          if (refund.status !== 'REFUND_PENDING') {
            this.storage.clear(pending.key);
            this.pending.set(null);
            this.sale.set(await this.api.getSale(this.id));
            return;
          }
        } catch (error) {
          if (describeError(error).code !== 'SALE_NOT_FOUND') throw error;
        }
        await this.send(pending);
      } else this.sale.set(await this.api.getSale(this.id));
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
