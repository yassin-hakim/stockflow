import { quantityMillis } from '@stockflow/primitives';
import { PendingStockCommands } from '../core/pending-stock-commands';
import { StockActionFormComponent } from './stock-action-form';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { InventoryOverview, StockMovement } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';

@Component({
  selector: 'app-product-detail',
  imports: [StockActionFormComponent, RouterLink, DatePipe],
  templateUrl: './product-detail.html',
})
export class ProductDetail {
  private readonly api = inject(BffApi);
  private readonly pendingCommands = inject(PendingStockCommands);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  private readonly fb = inject(FormBuilder);
  readonly addForm = this.fb.nonNullable.group({
    quantity: [0, Validators.required],
    reason: ['', Validators.required],
  });
  readonly removeForm = this.fb.nonNullable.group({
    quantity: [0, Validators.required],
    reason: ['', Validators.required],
  });
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly loadError = signal('');
  readonly historyLoading = signal(false);
  readonly historyError = signal('');
  readonly actionError = signal('');
  readonly validation = signal('');
  readonly message = signal('');
  readonly submitting = signal(false);
  readonly uncertain = signal(false);
  readonly recoveryBlocked = signal(false);
  readonly overview = signal<InventoryOverview | null>(null);
  readonly movements = signal<StockMovement[]>([]);
  private firstLoad = true;
  constructor() {
    this.restorePending();
    void this.reload();
  }
  restorePending(): void {
    try {
      const pending = this.pendingCommands.get(this.id);
      this.uncertain.set(!!pending);
      this.recoveryBlocked.set(false);
      if (pending) {
        const form = pending.type === 'add' ? this.addForm : this.removeForm;
        form.setValue({ quantity: pending.quantity, reason: pending.reason });
      }
    } catch {
      this.recoveryBlocked.set(true);
      this.actionError.set(
        'Saved stock requests could not be recovered. Restore browser storage and reload before submitting.',
      );
    }
  }
  async reload(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    this.notFound.set(false);
    try {
      this.overview.set(await this.api.getInventory(this.id));
    } catch (error) {
      const failure = describeError(error);
      if (failure.code === 'PRODUCT_NOT_FOUND') this.notFound.set(true);
      else this.loadError.set(failure.message);
    } finally {
      this.loading.set(false);
      if (this.firstLoad) {
        this.firstLoad = false;
        setTimeout(() => {
          const heading = document.querySelector<HTMLElement>('.shell-main h1');
          heading?.setAttribute('tabindex', '-1');
          heading?.focus();
        }, 0);
      }
    }
    if (!this.notFound() && !this.loadError()) await this.loadHistory();
  }
  async loadHistory(): Promise<void> {
    this.historyLoading.set(true);
    this.historyError.set('');
    try {
      this.movements.set((await this.api.getMovements(this.id)).items);
    } catch (error) {
      this.historyError.set(describeError(error).message);
    } finally {
      this.historyLoading.set(false);
    }
  }
  async submit(type: 'add' | 'remove'): Promise<void> {
    if (this.submitting() || this.recoveryBlocked()) return;
    this.actionError.set('');
    this.validation.set('');
    this.message.set('');
    const form = type === 'add' ? this.addForm : this.removeForm;
    const quantity = Number(form.value.quantity),
      reason = (form.value.reason ?? '').trim();
    const quantityInvalid = quantityMillis(quantity) === null;
    const reasonInvalid = !reason || reason.length > 200;
    if (form.invalid || quantityInvalid || reasonInvalid) {
      this.validation.set(`${type}-${quantityInvalid ? 'quantity' : 'reason'}`);
      this.actionError.set('Check the highlighted field before submitting.');
      setTimeout(() => document.getElementById(this.validation())?.focus(), 0);
      return;
    }
    this.submitting.set(true);
    let key: string | undefined;
    let sent = false;
    try {
      const pending = this.pendingCommands.get(this.id);
      if (
        pending &&
        (pending.type !== type || pending.quantity !== quantity || pending.reason !== reason)
      ) {
        this.actionError.set(
          'The previous request outcome is uncertain. Restore its original values and retry with the same key before starting another action.',
        );
        this.uncertain.set(true);
        setTimeout(() => document.querySelector<HTMLElement>('[data-action-error]')?.focus(), 0);
        return;
      }
      key = pending?.key ?? crypto.randomUUID();
      this.pendingCommands.save({ productId: this.id, type, quantity, reason, key });
      sent = true;
      const result = await this.api.changeStock(this.id, type, { quantity, reason }, key);
      this.pendingCommands.clear(this.id, key);
      this.uncertain.set(false);
      this.message.set(
        `${type === 'add' ? 'Added' : 'Removed'} ${quantity} ${this.overview()?.product.unit ?? ''}. Committed balance: ${result.quantity}.`,
      );
      form.reset({ quantity: 0, reason: '' });
      await this.reload();
    } catch (error) {
      const failure = describeError(error);
      this.actionError.set(failure.message);
      const uncertain =
        sent &&
        ['NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR'].includes(
          failure.code,
        );
      this.uncertain.set(uncertain);
      if (!uncertain && key) {
        try {
          this.pendingCommands.clear(this.id, key);
        } catch {
          this.recoveryBlocked.set(true);
        }
      }
      if (!sent)
        this.actionError.set(
          'The stock request could not be saved safely. Check browser storage and retry; no request was sent.',
        );
      if (failure.code === 'INSUFFICIENT_STOCK') await this.reload();
      setTimeout(() => document.querySelector<HTMLElement>('[data-action-error]')?.focus(), 0);
    } finally {
      this.submitting.set(false);
    }
  }
}
