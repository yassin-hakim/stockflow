import { Pagination, Paging } from '../shared/pagination';
import { ReadableText } from '../shared/readable-text';
import { recordReason } from '../shared/record-labels';
import { localInstant } from '../reports/report-period';
import { quantityMillis } from '@stockflow/primitives';
import { PendingStockCommands } from '../core/pending-stock-commands';
import { createStockRequestKey } from '../core/stock-request-key';
import { StockActionFormComponent } from './stock-action-form';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { InventoryOverview, StockMovement, Location, StockView } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';

@Component({
  selector: 'app-product-detail',
  imports: [Pagination, ReadableText, StockActionFormComponent, ReactiveFormsModule, RouterLink, DatePipe],
  templateUrl: './product-detail.html',
})
export class ProductDetail {
  readonly pager = new Paging();
  async resizePage(size:number){this.pager.resize(size);await this.pageTo(1);}
  async pageTo(page:number) { await this.pager.go(page,()=>this.movements().length,()=>this.historyCursor() !== null,()=>this.loadHistory(true)); }

  productNames(){const product=this.overview()?.product;return product?[product]:[];}
  movementReason(reason:string){return recordReason(reason,this.productNames(),this.locations());}
  selectLocation(id: string): void {
    if (this.submitting() || this.uncertain() || this.recoveryBlocked()) return;
    this.locationId.set(id);
    void this.reload();
  }
  selectedLocationName(): string {
    const loc = this.locations().find(l => l.id === this.locationId());
    return loc?.name ?? 'Selected location';
  }
  private readonly api = inject(BffApi);
  private readonly pendingCommands = inject(PendingStockCommands);
  private readonly route=inject(ActivatedRoute);
  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly locationId=signal(this.route.snapshot.queryParamMap?.get('location') ?? '00000000-0000-4000-8000-000000000001');
  readonly locations=signal<Location[]>([]);
  readonly total=signal<StockView|null>(null);
  readonly locationPager = new Paging();
  readonly historyCursor=signal<string|null>(null);
  private readonly fb = inject(FormBuilder);
  readonly historyFilters = this.fb.nonNullable.group({cause:[''],from:[''],to:['']});
  private appliedHistoryFilters: Record<string,string> = {};
  readonly historyValidation = signal('');
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
        this.locationId.set(pending.locationId ?? '00000000-0000-4000-8000-000000000001');
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
      const [locations,total,stock]=await Promise.all([this.api.listLocations(),this.api.getStock(this.id),this.api.getStock(this.id,this.locationId())]);
      this.locations.set(locations.items);this.total.set(total);this.overview.set(stock);
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
  async loadHistory(more=false): Promise<void> {
    if (!more) {
      const {cause,from,to} = this.historyFilters.getRawValue();
      const start = from ? localInstant(from) : null, end = to ? localInstant(to) : null;
      if ((from && !start) || (to && !end) || (start && end && start >= end)) {
        this.historyValidation.set('Choose valid dates with the end after the start.');
        return;
      }
      this.historyValidation.set('');
      this.appliedHistoryFilters = {...(cause?{cause}:{}),...(start?{from:start}:{}),...(end?{to:end}:{})};
      this.pager.reset();
    }
    this.historyLoading.set(true);
    this.historyError.set('');
    try {
      const page=await this.api.getStockMovements(this.id,{...this.appliedHistoryFilters,locationId:this.locationId(),...(more&&this.historyCursor()?{cursor:this.historyCursor()!}:{})});
      this.movements.set(more?[...this.movements(),...page.items]:page.items);this.historyCursor.set(page.nextCursor);
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
        (pending.type !== type || pending.quantity !== quantity || pending.reason !== reason || (pending.locationId ?? '00000000-0000-4000-8000-000000000001')!==this.locationId())
      ) {
        this.actionError.set(
          'The previous request outcome is uncertain. Restore its original values and retry with the same key before starting another action.',
        );
        this.uncertain.set(true);
        setTimeout(() => document.querySelector<HTMLElement>('[data-action-error]')?.focus(), 0);
        return;
      }
      key = pending?.key ?? createStockRequestKey();
      const legacy=pending && pending.locationId===undefined;
      this.pendingCommands.save({ productId: this.id, type, quantity, reason, key,...(!legacy?{locationId:this.locationId()}:{}) });
      sent = true;
      const result = legacy ? await this.api.changeStock(this.id, type, { quantity, reason }, key) : await this.api.changeLocationStock(this.id,type,{locationId:this.locationId(),quantity,reason},key);
      this.pendingCommands.clear(this.id, key);
      this.uncertain.set(false);
      this.message.set(
        `${type === 'add' ? 'Added' : 'Removed'} ${quantity} ${this.overview()?.product.unit ?? ''}. Committed balance: ${'quantity' in result ? result.quantity : result.movements[0]?.resultingQuantity}.`,
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
