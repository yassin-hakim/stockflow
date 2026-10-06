import { CurrencyPipe } from '@angular/common';
import { Pagination, Paging } from '../shared/pagination';
import { SectionNav } from '../shared/section-nav';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Location, Product, Sale, StockCount, StockOperation } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
import { ReadableText } from '../shared/readable-text';
import { localInstant } from '../reports/report-period';
import {
  containsUuid,
  operationKind,
  operationLabel,
  recordReason,
  saleLabel,
} from '../shared/record-labels';

@Component({
  selector: 'app-operation-history',
  imports: [Pagination, ReadableText, SectionNav, RouterLink, DatePipe, CurrencyPipe],
  templateUrl: './operation-history.html',
})
export class OperationHistory {
  readonly pager = new Paging();
  async resizePage(size:number){this.pager.resize(size);await this.pageTo(1);}
  async pageTo(page:number) { await this.pager.go(page,()=>this.items().length,()=>this.cursor() !== null,()=>this.load(true)); }

  private readonly api = inject(BffApi);
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
  readonly items = signal<StockOperation[]>([]);
  readonly counts = signal<StockCount[]>([]);
  readonly countPager=new Paging();
  readonly countsCursor=signal<string|null>(null);
  readonly countsLoading=signal(false);
  readonly countsError=signal('');
  async countsPageTo(page:number){await this.countPager.go(page,()=>this.counts().length,()=>!!this.countsCursor(),async()=>{
    this.countsLoading.set(true);this.countsError.set('');
    try{const result=await this.api.listCounts(this.countsCursor()!);this.counts.update(rows=>[...rows,...result.items]);this.countsCursor.set(result.nextCursor);}
    catch(error){this.countsError.set(describeError(error).message);}finally{this.countsLoading.set(false);}
  });}
  async countsResize(size:number){this.countPager.resize(size);await this.countsPageTo(1);}

  readonly selected = signal<StockOperation | null>(null);
  readonly locations = signal<Location[]>([]);
  readonly products = signal<Product[]>([]);
  readonly linkedSale = signal<Sale | null>(null);
  readonly names = computed(() => [
    ...this.products(),
    ...this.locations(),
    ...(this.linkedSale()?.lines.flatMap((line) => line.ingredients) ?? []),
  ]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly cursor = signal<string | null>(null);
  readonly kind = signal('');
  readonly filterLocation = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly filterError = signal('');
  private appliedFilters: Record<string,string> = {};
  private appliedKind = '';
  constructor() {
    void this.load();
  }
  location(id: string | undefined) {
    return this.locations().find((row) => row.id === id)?.name ?? 'Unavailable location';
  }
  product(id: string) {
    return this.products().find((row) => row.id === id)?.name ?? 'Unavailable ingredient';
  }
  readonly kindName = operationKind;
  label(operation: StockOperation) {
    if (operation.kind === 'SALE' && this.linkedSale()?.id === operation.reference)
      return `Sale · ${saleLabel(this.linkedSale()!)}`;
    return operationLabel(operation, this.location(operation.locationId));
  }
  reason(operation: StockOperation) {
    return recordReason(operation.reason, this.names());
  }
  unit(id: string) {
    return this.products().find((row) => row.id === id)?.unit ?? '';
  }
  async load(more = false) {
    if (!more && !this.id) {
      const start = this.from() ? localInstant(this.from()) : null;
      const end = this.to() ? localInstant(this.to()) : null;
      if ((this.from() && !start) || (this.to() && !end) || (start && end && start >= end)) {
        this.filterError.set('Choose valid dates with the end after the start.');
        return;
      }
      this.filterError.set('');
      this.appliedKind = this.kind();
      this.appliedFilters = {...(this.filterLocation()?{locationId:this.filterLocation()}:{}),...(start?{from:start}:{}),...(end?{to:end}:{})};
    }
    if(!more) this.pager.reset();
    this.loading.set(true);
    this.error.set('');
    try {
      const [locations, products] = await Promise.all([
        this.api.listLocations(),
        this.api.listProducts(),
      ]);
      this.locations.set(locations.items);
      this.products.set(products.items);
      if (this.id) {
        const operation = await this.api.getOperation(this.id);
        this.selected.set(operation);
        this.linkedSale.set(null);
        if (operation.kind === 'SALE' && containsUuid(operation.reference)) {
          try {
            this.linkedSale.set(await this.api.getSale(operation.reference));
          } catch {
            /* The operation remains readable if its linked sale is unavailable. */
          }
        }
      } else {
        const [page, counts] = await Promise.all([
          this.api.listOperations(
            this.appliedKind || undefined,
            more ? (this.cursor() ?? undefined) : undefined,
            this.appliedFilters,
          ),
          more?Promise.resolve({items:this.counts(),nextCursor:this.countsCursor()}):this.api.listCounts(),
        ]);
        this.items.set(more ? [...this.items(), ...page.items] : page.items);
        this.cursor.set(page.nextCursor);
        this.counts.set(counts.items);this.countsCursor.set(counts.nextCursor);
        if(!more)this.countPager.reset();
      }
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
