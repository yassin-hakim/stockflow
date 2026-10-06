import { Pagination, Paging } from '../shared/pagination';
import { containsUuid, movementLabel, recordReason, recordTime } from '../shared/record-labels';
import { ReadableText } from '../shared/readable-text';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type {
  InventoryReport,
  Location,
  MovementCause,
  SalesReport, ProfitLossReport,
  StockMovementV2,
} from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
import { defaultPeriod, localInstant } from './report-period';

type Kind = 'inventory' | 'sales' | 'profit-loss';
interface FilterForm {
  kind: Kind;
  from: string;
  to: string;
  locationId: string;
  cause: string;
}
interface AppliedScope {
  kind: Kind;
  params: Record<string, string>;
  form: FilterForm;
  locationName: string;
}
const CAUSES: { value: MovementCause; label: string }[] = [
  { value: 'MANUAL', label: 'Manual stock changes' },
  { value: 'RECEIPT', label: 'Receiving' },
  { value: 'TRANSFER', label: 'Transfers' },
  { value: 'WASTE', label: 'Waste' },
  { value: 'COUNT', label: 'Count adjustments' },
  { value: 'SALE', label: 'Sale consumption' },
  { value: 'SALE_RETURN', label: 'Sale stock returns' },
];

@Component({
  selector: 'app-reports',
  imports: [Pagination, ReadableText, ReactiveFormsModule, RouterLink, DatePipe, DecimalPipe],
  templateUrl: './reports.html',
  styleUrl: './reports.css',
})
export class Reports {
  readonly pager = new Paging();
  readonly productPager = new Paging();
  readonly profit = signal<ProfitLossReport|null>(null);
  records(){return this.profit()?.items ?? this.sales()?.items ?? this.inventory()?.items ?? [];}
  async resizePage(size:number){this.pager.resize(size);await this.pageTo(1);}
  async pageTo(page:number){await this.pager.go(page,()=>this.records().length,()=>!!this.nextCursor(),()=>this.loadMore());}

  private readonly api = inject(BffApi);
  private requested: AppliedScope | null = null;
  private readonly period = defaultPeriod();
  readonly form = inject(FormBuilder).nonNullable.group({
    kind: ['sales' as Kind],
    from: [this.period.from],
    to: [this.period.to],
    locationId: [''],
    cause: [''],
  });
  readonly applied = signal<AppliedScope | null>(null);
  readonly inventory = signal<InventoryReport | null>(null);
  readonly sales = signal<SalesReport | null>(null);
  readonly locations = signal<Location[]>([]);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly exporting = signal(false);
  readonly locationLoading = signal(false);
  readonly locationError = signal('');
  readonly error = signal('');
  readonly moreError = signal('');
  readonly exportError = signal('');
  readonly success = signal('');
  readonly validation = signal('');
  readonly causes = CAUSES;
  constructor() {
    void this.loadLocations();
    void this.apply();
  }

  async loadLocations(): Promise<void> {
    this.locationLoading.set(true);
    this.locationError.set('');
    try {
      this.locations.set((await this.api.listLocations()).items);
    } catch (error) {
      this.locationError.set(describeError(error).message);
    } finally {
      this.locationLoading.set(false);
    }
  }
  locationName(id: string): string {
    return this.locations().find((location) => location.id === id)?.name ?? 'Unavailable location';
  }
  readonly movementReference = movementLabel;
  salesReference(row:Pick<SalesReport['items'][number],'reference'|'kind'|'lines'|'occurredAt'>){
    if(row.reference && !containsUuid(row.reference)) return row.reference;
    return `${row.kind==='REFUND'?'Refund':'Sale'} · ${row.lines.map(line=>`${line.quantity} × ${line.name}`).join(', ')} · ${recordTime(row.occurredAt)}`;
  }
  movementReason(movement:StockMovementV2){
    return recordReason(movement.reason,this.inventory()?.products??[],this.locations());
  }
  causeName(cause: string): string {
    return CAUSES.find((value) => value.value === cause)?.label ?? cause;
  }
  filtersChanged(): boolean {
    const scope = this.applied();
    return !!scope && JSON.stringify(this.form.getRawValue()) !== JSON.stringify(scope.form);
  }
  money(minor: number, currency: string): string {
    const value = BigInt(minor),
      absolute = value < 0n ? -value : value;
    return `${currency} ${value < 0n ? '−' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }
  signed(value: number): string {
    return `${value < 0 ? '−' : value > 0 ? '+' : ''}${Math.abs(value)}`;
  }
  productFact(id: string) {
    return this.inventory()?.products.find((product) => product.productId === id);
  }
  movementQuantity(movement: StockMovementV2): string {
    return `${movement.type === 'ADD' ? '+' : '−'}${movement.quantity} ${this.productFact(movement.productId)?.unit ?? ''}`;
  }
  nextCursor(): string | null {
    if(this.applied()?.kind==='profit-loss')return this.profit()?.nextCursor??null;
    return this.applied()?.kind === 'sales'
      ? (this.sales()?.nextCursor ?? null)
      : (this.inventory()?.nextCursor ?? null);
  }

  async apply(): Promise<void> {
    if (this.loading() || this.loadingMore()) return;
    this.validation.set('');
    const form = this.form.getRawValue();
    const from = localInstant(form.from),
      to = localInstant(form.to);
    if (!from || !to || new Date(from).getTime() >= new Date(to).getTime()) {
      this.validation.set('Enter valid local dates and times. Until must be later than From.');
      this.focus('report-validation');
      return;
    }
    const params: Record<string, string> = { from, to, limit: '25' };
    if (form.locationId) params['locationId'] = form.locationId;
    if (form.kind === 'inventory' && form.cause) params['cause'] = form.cause;
    this.requested = {
      kind: form.kind,
      params,
      form,
      locationName: form.locationId ? this.locationName(form.locationId) : 'All locations',
    };
    await this.fetch(this.requested);
  }
  async retry(): Promise<void> {
    if (this.requested && !this.loading()) await this.fetch(this.requested);
  }
  private async fetch(scope: AppliedScope): Promise<void> {
    this.pager.reset(); this.productPager.reset();
    this.loading.set(true);
    this.error.set('');
    this.moreError.set('');
    this.exportError.set('');
    this.success.set('');
    try {
      if(scope.kind==='profit-loss'){this.profit.set(await this.api.getProfitLossReport({...scope.params}));this.sales.set(null);this.inventory.set(null);}
      else if (scope.kind === 'sales') {
        this.profit.set(null);
        this.sales.set(await this.api.getSalesReport({ ...scope.params }));
        this.inventory.set(null);
      } else {
        this.profit.set(null);
        this.inventory.set(await this.api.getInventoryReport({ ...scope.params }));
        this.sales.set(null);
      }
      this.applied.set(scope);
    } catch (error) {
      this.error.set(describeError(error).message);
      this.focus('report-error');
    } finally {
      this.loading.set(false);
    }
  }
  async loadMore(): Promise<void> {
    const scope = this.applied(),
      cursor = this.nextCursor();
    if (!scope || !cursor || this.loading() || this.loadingMore() || this.error()) return;
    this.loadingMore.set(true);
    this.moreError.set('');
    try {
      const params = { ...scope.params, cursor };
      if(scope.kind==='profit-loss'){const previous=this.profit()!,page=await this.api.getProfitLossReport(params);const known=new Set(previous.items.map(row=>row.kind+row.id));this.profit.set({...page,items:[...previous.items,...page.items.filter(row=>!known.has(row.kind+row.id))]});}
      else if (scope.kind === 'sales') {
        const previous = this.sales()!,
          page = await this.api.getSalesReport(params);
        const known = new Set(previous.items.map((row) => `${row.kind}:${row.id}`));
        this.sales.set({
          ...page,
          items: [
            ...previous.items,
            ...page.items.filter((row) => !known.has(`${row.kind}:${row.id}`)),
          ],
        });
      } else {
        const previous = this.inventory()!,
          page = await this.api.getInventoryReport(params);
        const known = new Set(previous.items.map((row) => row.id));
        this.inventory.set({
          ...page,
          items: [...previous.items, ...page.items.filter((row) => !known.has(row.id))],
        });
      }
    } catch (error) {
      this.moreError.set(describeError(error).message);
    } finally {
      this.loadingMore.set(false);
    }
  }
  async exportCsv(): Promise<void> {
    const scope = this.applied();
    if (!scope || this.loading() || this.loadingMore() || this.exporting() || this.error()) return;
    this.exporting.set(true);
    this.exportError.set('');
    this.success.set('');
    try {
      const blob = await this.api.exportReport(scope.kind, { ...scope.params });
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${scope.kind}-report-${scope.params['from'].slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      this.success.set(
        'CSV downloaded for the displayed report filters. It includes all matching records.',
      );
    } catch (error) {
      this.exportError.set(await this.exportMessage(error));
    } finally {
      this.exporting.set(false);
    }
  }
  private async exportMessage(error: unknown): Promise<string> {
    // HttpClient's blob response mode also returns a failed JSON response as Blob.
    if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
      try {
        const body = JSON.parse(await error.error.text());
        if (typeof body?.error?.message === 'string' && typeof body?.error?.code === 'string')
          return body.error.message;
      } catch {
        /* fall back to the standard recoverable message */
      }
    }
    return describeError(error).message;
  }
  private focus(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }
}
