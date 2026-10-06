import { Pagination, Paging } from '../shared/pagination';
import { ReadableText } from '../shared/readable-text';
import { SectionNav } from '../shared/section-nav';
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Location, Product, StockCount, StockOperation } from '@stockflow/contracts';
import { isUuid, quantityMillis } from '@stockflow/primitives';
import { BffApi, describeError } from '../core/bff-api';
import { STOCK_REQUEST_STORAGE } from '../core/pending-stock-commands';
import { createStockRequestKey } from '../core/stock-request-key';
interface CountRequest {
  kind: 'CREATE' | 'APPLY';
  key: string;
  countId?: string;
  expectedVersion?: number;
  body?: { locationId: string; productIds: string[]; reason: string };
}
@Component({
  selector: 'app-stock-counts',
  imports: [Pagination, ReadableText, SectionNav, ReactiveFormsModule, RouterLink, DatePipe],
  templateUrl: './stock-count.html',
})
export class StockCounts {
  readonly pager = new Paging();
  readonly productPager=new Paging();
  async resizePage(size:number){this.pager.resize(size);await this.pageTo(1);}
  async pageTo(page:number) { await this.pager.go(page,()=>this.counts().length,()=>this.nextCursor() !== null,()=>this.loadMore()); }

  private readonly api = inject(BffApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly storage = inject(STOCK_REQUEST_STORAGE);
  private readonly storageName = 'stockflow:pending-count:v2';
  readonly mode =
    this.route.snapshot.routeConfig?.path === 'counts/new'
      ? 'new'
      : this.route.snapshot.paramMap.has('id')
        ? 'detail'
        : 'list';
  readonly createForm = this.fb.nonNullable.group({
    locationId: ['', Validators.required],
    reason: ['', [Validators.required, Validators.maxLength(200)]],
  });
  readonly entryForm = this.fb.group({
    lines: this.fb.array([] as ReturnType<StockCounts['line']>[]),
  });
  readonly chosen = signal<string[]>([]);
  readonly locations = signal<Location[]>([]);
  readonly products = signal<Product[]>([]);
  readonly counts = signal<StockCount[]>([]);
  readonly count = signal<StockCount | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly reviewed = signal(false);
  readonly confirmed = signal(false);
  readonly stale = signal(false);
  readonly pending = signal<CountRequest | null>(null);
  readonly storageBlocked = signal(false);
  readonly nextCursor = signal<string | null>(null);
  readonly locked = computed(() => this.busy() || !!this.pending() || this.storageBlocked());
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => void this.load());
  }
  get lines() {
    return this.entryForm.controls.lines;
  }
  private line(productId: string, countedQuantity: number | null) {
    return this.fb.group({
      productId: this.fb.nonNullable.control(productId),
      countedQuantity: this.fb.control<number | null>(countedQuantity),
    });
  }
  product(id: string) {
    return this.products().find((item) => item.id === id);
  }
  location(id: string) {
    return this.locations().find((item) => item.id === id)?.name ?? 'Unavailable location';
  }
  choose(id: string, checked: boolean) {
    if (!this.locked())
      this.chosen.update((values) =>
        checked ? [...values, id] : values.filter((value) => value !== id),
      );
  }
  unreview() {
    this.reviewed.set(false);
    this.confirmed.set(false);
  }
  private restoreStorage() {
    if (!this.storage) throw new Error('Browser storage is unavailable.');
    const raw = this.storage.getItem(this.storageName);
    if (!raw) return;
    const value = JSON.parse(raw) as CountRequest;
    if (
      !value ||
      !isUuid(value.key) ||
      !['CREATE', 'APPLY'].includes(value.kind) ||
      (value.kind === 'CREATE' &&
        (!value.body ||
          !isUuid(value.body.locationId) ||
          !Array.isArray(value.body.productIds) ||
          value.body.productIds.some((id) => !isUuid(id)) ||
          typeof value.body.reason !== 'string')) ||
      (value.kind === 'APPLY' &&
        (!isUuid(value.countId) || !Number.isSafeInteger(value.expectedVersion)))
    )
      throw new Error('The saved count request could not be recovered.');
    this.pending.set(value);
    if (value.kind === 'CREATE' && value.body) {
      this.createForm.setValue({ locationId: value.body.locationId, reason: value.body.reason });
      this.chosen.set(value.body.productIds);
    }
  }
  private savePending(value: CountRequest) {
    if (!this.storage) throw new Error('Browser storage is unavailable.');
    const existing = this.pending();
    if (existing && JSON.stringify(existing) !== JSON.stringify(value))
      throw new Error('Resolve the earlier count request first.');
    this.storage.setItem(this.storageName, JSON.stringify(value));
    this.pending.set(value);
  }
  private clearPending() {
    if (!this.storage) throw new Error('Browser storage is unavailable.');
    this.storage.removeItem(this.storageName);
    this.pending.set(null);
  }
  async load() {
    this.pager.reset();
    this.loading.set(true);
    this.error.set('');
    this.storageBlocked.set(false);
    try {
      this.restoreStorage();
      const [locations, products] = await Promise.all([
        this.api.listLocations(),
        this.api.listProducts(),
      ]);
      this.locations.set(locations.items);
      this.products.set(products.items);
      if (this.mode === 'detail') {
        const value = await this.api.getCount(this.route.snapshot.paramMap.get('id')!);
        this.populate(value);
      } else if (this.mode === 'list') {
        const page = await this.api.listCounts();
        this.counts.set(page.items);
        this.nextCursor.set(page.nextCursor);
      } else if (!this.pending())
        this.createForm.controls.locationId.setValue(locations.items[0]?.id ?? '');
    } catch (error) {
      this.error.set(
        error instanceof Error && !('status' in error)
          ? error.message
          : describeError(error).message,
      );
      if (error instanceof Error && !('status' in error)) this.storageBlocked.set(true);
    } finally {
      this.loading.set(false);
    }
  }
  async loadMore() {
    const cursor = this.nextCursor();
    if (!cursor || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const page = await this.api.listCounts(cursor);
      this.counts.update((values) => [...values, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.busy.set(false);
    }
  }
  private populate(value: StockCount) {
    this.count.set(value);
    this.lines.clear();
    for (const line of value.lines)
      this.lines.push(this.line(line.productId, line.countedQuantity));
    this.unreview();
  }
  private failure(error: unknown) {
    const failure = describeError(error);
    this.error.set(failure.message);
    if (
      !['NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR'].includes(
        failure.code,
      )
    ) {
      this.clearPending();
      if (failure.code === 'COUNT_STALE') this.stale.set(true);
    }
    queueMicrotask(() => document.getElementById('count-error')?.focus());
  }
  async create() {
    if (this.busy() || this.storageBlocked()) return;
    const previous = this.pending();
    if (previous && previous.kind !== 'CREATE') {
      this.error.set('Resolve the earlier count apply first.');
      return;
    }
    const value = this.createForm.getRawValue();
    if (
      !previous &&
      (this.createForm.invalid ||
        !value.reason.trim() ||
        !this.chosen().length ||
        this.chosen().length > 100)
    ) {
      this.error.set('Choose a location, 1–100 products and a count explanation.');
      return;
    }
    const request: CountRequest = previous ?? {
      kind: 'CREATE',
      key: createStockRequestKey(),
      body: { ...value, reason: value.reason.trim(), productIds: this.chosen() },
    };
    try {
      this.savePending(request);
    } catch {
      this.storageBlocked.set(true);
      this.error.set(
        'The count identity could not be saved. Restore browser storage before submitting.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const count = await this.api.createCount(request.body!, request.key);
      this.clearPending();
      await this.router.navigate(['/counts', count.id]);
    } catch (error) {
      this.failure(error);
    } finally {
      this.busy.set(false);
    }
  }
  async saveReview() {
    const current = this.count();
    if (!current || this.locked() || this.stale()) return;
    const entries = this.entryForm.getRawValue().lines;
    if (
      entries.some(
        (line) =>
          line.countedQuantity === null || quantityMillis(line.countedQuantity, true) === null,
      )
    ) {
      this.error.set('Enter every physical quantity. Zero is valid; a blank field is uncounted.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await this.api.editCount(current.id, {
        expectedVersion: current.version,
        lines: entries.map((line) => ({
          productId: line.productId!,
          countedQuantity: line.countedQuantity!,
        })),
      });
      this.count.set(saved);
      this.reviewed.set(true);
      this.confirmed.set(false);
      this.message.set('Entries saved. Review the server-calculated differences before applying.');
      queueMicrotask(() => document.getElementById('count-review')?.focus());
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.busy.set(false);
    }
  }
  async apply() {
    const current = this.count(),
      previous = this.pending();
    if (!current || this.busy() || this.storageBlocked()) return;
    if (previous && (previous.kind !== 'APPLY' || previous.countId !== current.id)) {
      this.error.set('Resolve the earlier count request first.');
      return;
    }
    if (!previous && (!this.reviewed() || !this.confirmed() || this.stale())) return;
    const request: CountRequest = previous ?? {
      kind: 'APPLY',
      key: createStockRequestKey(),
      countId: current.id,
      expectedVersion: current.version,
    };
    try {
      this.savePending(request);
    } catch {
      this.storageBlocked.set(true);
      this.error.set(
        'The apply identity could not be saved. Restore browser storage before submitting.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.finish(
        await this.api.applyCount(request.countId!, request.expectedVersion!, request.key),
      );
    } catch (error) {
      this.failure(error);
    } finally {
      this.busy.set(false);
    }
  }
  private async finish(result: StockOperation) {
    this.clearPending();
    if (result.status === 'REJECTED') {
      this.error.set(result.error?.message ?? 'Count rejected.');
      if (result.error?.code === 'COUNT_STALE') this.stale.set(true);
      return;
    }
    this.message.set(
      'Count applied. Recorded stock now matches the confirmed physical quantities.',
    );
    if (this.count()?.id === result.reference)
      this.populate(await this.api.getCount(result.reference));
    else await this.router.navigate(['/counts', result.reference]);
  }
  async checkStatus() {
    const request = this.pending();
    if (!request || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      if (request.kind === 'CREATE') {
        const value = await this.api.getCount(request.key);
        this.clearPending();
        await this.router.navigate(['/counts', value.id]);
      } else await this.finish(await this.api.getOperation(request.key));
    } catch (error) {
      const failure = describeError(error);
      this.error.set(
        ['COUNT_NOT_FOUND', 'OPERATION_NOT_FOUND'].includes(failure.code)
          ? 'The request is not recorded yet. Retry its original input and identity to resolve it safely.'
          : failure.message,
      );
    } finally {
      this.busy.set(false);
    }
  }
  async cancel() {
    const current = this.count();
    if (!current || this.locked()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.populate(await this.api.cancelCount(current.id, current.version));
      this.message.set('Count cancelled. Stock was unchanged.');
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
