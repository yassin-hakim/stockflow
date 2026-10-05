import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { InventoryOverview, StockMovement } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';

@Component({ selector: 'app-product-detail', imports: [ReactiveFormsModule, RouterLink, DatePipe], template: `
  <p><a routerLink="/inventory">← Inventory</a></p>
  @if (loading()) { <p role="status">Loading product…</p> }
  @else if (notFound()) { <section class="panel"><h1>Product not found</h1><p>This product does not exist.</p><a routerLink="/inventory">Return to inventory</a></section> }
  @else if (loadError()) { <div class="error" role="alert">{{ loadError() }}</div><p><button type="button" (click)="reload()">Retry</button></p> }
  @else if (overview(); as stock) {
    <div class="page-head"><div><h1>{{ stock.product.name }}</h1><p class="muted">{{ stock.product.category }} · {{ stock.product.unit }}</p></div><span class="status" [class]="'status ' + stock.status">{{ stock.status }}</span></div>
    <section class="panel" style="margin-bottom:1rem"><h2>Current stock</h2><p style="font-size:2rem;font-weight:800;margin-bottom:.3rem">{{ stock.quantity }} {{ stock.product.unit }}</p><p class="muted">Low-stock threshold: {{ stock.product.lowStockThreshold }} {{ stock.product.unit }}</p></section>
    @if (message()) { <p class="success" role="status">{{ message() }}</p> }
    @if (actionError()) { <p class="error" role="alert" tabindex="-1" data-action-error>{{ actionError() }}</p> }
    <div class="grid-2" style="margin-bottom:1rem">
      <form class="panel" [formGroup]="addForm" (ngSubmit)="submit('add')" novalidate><h2>Add stock</h2>
        <div class="field"><label for="add-quantity">Quantity ({{ stock.product.unit }})</label><input id="add-quantity" type="number" min="0.001" max="1000000000" step="0.001" formControlName="quantity" required [attr.aria-invalid]="validation() === 'add-quantity' ? 'true' : null" [attr.aria-describedby]="validation() === 'add-quantity' ? 'add-quantity-error' : null">@if (validation() === 'add-quantity') { <small class="error" id="add-quantity-error">Use 0.001–1,000,000,000 with at most three decimals.</small> }</div>
        <div class="field"><label for="add-reason">Reason</label><input id="add-reason" formControlName="reason" maxlength="200" required [attr.aria-invalid]="validation() === 'add-reason' ? 'true' : null" [attr.aria-describedby]="validation() === 'add-reason' ? 'add-reason-error' : null">@if (validation() === 'add-reason') { <small class="error" id="add-reason-error">Enter a reason of 1–200 characters.</small> }</div>
        <button type="submit" [disabled]="submitting()">{{ submitting() ? 'Saving…' : 'Add stock' }}</button>
      </form>
      <form class="panel" [formGroup]="removeForm" (ngSubmit)="submit('remove')" novalidate><h2>Remove stock</h2>
        <div class="field"><label for="remove-quantity">Quantity ({{ stock.product.unit }})</label><input id="remove-quantity" type="number" min="0.001" max="1000000000" step="0.001" formControlName="quantity" required [attr.aria-invalid]="validation() === 'remove-quantity' ? 'true' : null" [attr.aria-describedby]="validation() === 'remove-quantity' ? 'remove-quantity-error' : null">@if (validation() === 'remove-quantity') { <small class="error" id="remove-quantity-error">Use 0.001–1,000,000,000 with at most three decimals.</small> }</div>
        <div class="field"><label for="remove-reason">Reason</label><input id="remove-reason" formControlName="reason" maxlength="200" required [attr.aria-invalid]="validation() === 'remove-reason' ? 'true' : null" [attr.aria-describedby]="validation() === 'remove-reason' ? 'remove-reason-error' : null">@if (validation() === 'remove-reason') { <small class="error" id="remove-reason-error">Enter a reason of 1–200 characters.</small> }</div>
        <button type="submit" [disabled]="submitting()">{{ submitting() ? 'Saving…' : 'Remove stock' }}</button>
      </form>
    </div>
    <section class="panel"><h2>Movement history</h2>
      @if (historyLoading()) { <p role="status">Loading movements…</p> }
      @else if (historyError()) { <p class="error" role="alert">{{ historyError() }}</p><button type="button" (click)="loadHistory()">Retry history</button> }
      @else if (movements().length === 0) { <p class="muted">No stock movements yet.</p> }
      @else { <div class="table-wrap desktop-table"><table><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Quantity</th><th scope="col">Reason</th></tr></thead><tbody>
        @for (movement of movements(); track movement.id) { <tr><td>{{ movement.createdAt | date:'medium' }}</td><td>{{ movement.type }}</td><td>{{ movement.type === 'ADD' ? '+' : '−' }}{{ movement.quantity }} {{ stock.product.unit }}</td><td>{{ movement.reason }}</td></tr> }
      </tbody></table></div>
      <div class="stack mobile-list">@for (movement of movements(); track movement.id) { <article><strong>{{ movement.type === 'ADD' ? '+' : '−' }}{{ movement.quantity }} {{ stock.product.unit }}</strong><div>{{ movement.type }} · <time [attr.datetime]="movement.createdAt">{{ movement.createdAt | date:'medium' }}</time></div><p>{{ movement.reason }}</p></article> }</div> }
    </section>
  }
` })
export class ProductDetail {
  private readonly api = inject(BffApi);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  private readonly fb = inject(FormBuilder);
  readonly addForm = this.fb.nonNullable.group({ quantity: [0, Validators.required], reason: ['', Validators.required] });
  readonly removeForm = this.fb.nonNullable.group({ quantity: [0, Validators.required], reason: ['', Validators.required] });
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
  readonly overview = signal<InventoryOverview | null>(null);
  readonly movements = signal<StockMovement[]>([]);
  private firstLoad = true;
  private pending: { fingerprint: string; key: string } | null = null;
  constructor() { void this.reload(); }
  async reload(): Promise<void> {
    this.loading.set(true); this.loadError.set(''); this.notFound.set(false);
    try { this.overview.set(await this.api.getInventory(this.id)); }
    catch (error) { const failure = describeError(error); if (failure.code === 'PRODUCT_NOT_FOUND') this.notFound.set(true); else this.loadError.set(failure.message); }
    finally {
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
    this.historyLoading.set(true); this.historyError.set('');
    try { this.movements.set((await this.api.getMovements(this.id)).items); }
    catch (error) { this.historyError.set(describeError(error).message); }
    finally { this.historyLoading.set(false); }
  }
  async submit(type: 'add' | 'remove'): Promise<void> {
    if (this.submitting()) return;
    this.actionError.set(''); this.validation.set(''); this.message.set('');
    const form = type === 'add' ? this.addForm : this.removeForm;
    const quantity = Number(form.value.quantity), reason = (form.value.reason ?? '').trim();
    const scaled = quantity * 1000;
    const quantityInvalid = !Number.isFinite(scaled) || scaled < 1 || scaled > 1_000_000_000_000 || Math.abs(scaled - Math.round(scaled)) > 0.00001;
    const reasonInvalid = !reason || reason.length > 200;
    if (form.invalid || quantityInvalid || reasonInvalid) { this.validation.set(`${type}-${quantityInvalid ? 'quantity' : 'reason'}`); this.actionError.set('Check the highlighted field before submitting.'); setTimeout(() => document.getElementById(this.validation())?.focus(), 0); return; }
    const fingerprint = JSON.stringify({ type, quantity, reason });
    if (this.uncertain() && this.pending?.fingerprint !== fingerprint) { this.actionError.set('The previous request outcome is uncertain. Restore its original values and retry with the same key before starting another action.'); setTimeout(() => document.querySelector<HTMLElement>('[data-action-error]')?.focus(), 0); return; }
    if (this.pending?.fingerprint !== fingerprint) this.pending = { fingerprint, key: crypto.randomUUID() };
    this.submitting.set(true);
    try {
      const result = await this.api.changeStock(this.id, type, { quantity, reason }, this.pending.key);
      this.pending = null;
      this.uncertain.set(false);
      this.message.set(`${type === 'add' ? 'Added' : 'Removed'} ${quantity} ${this.overview()?.product.unit ?? ''}. Committed balance: ${result.quantity}.`);
      form.reset({ quantity: 0, reason: '' });
      await this.reload();
    } catch (error) {
      const failure = describeError(error);
      this.actionError.set(failure.message);
      if (['NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(failure.code)) this.uncertain.set(true);
      if (failure.code === 'IDEMPOTENCY_CONFLICT') { this.pending = null; this.uncertain.set(false); }
      if (failure.code === 'INSUFFICIENT_STOCK') await this.reload();
      setTimeout(() => document.querySelector<HTMLElement>('[data-action-error]')?.focus(), 0);
    } finally { this.submitting.set(false); }
  }
}
