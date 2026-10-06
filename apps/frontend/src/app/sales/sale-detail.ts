import { Pagination, Paging } from '../shared/pagination';
import { saleLabel } from '../shared/record-labels';
import { ReadableText } from '../shared/readable-text';
import { Component, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Sale, Location } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
@Component({
  selector: 'app-sale-detail',
  imports: [Pagination, ReadableText, RouterLink, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './sale-detail.html',
  styleUrl: './sales.css',
})
export class SaleDetail {
  readonly refundPager=new Paging();
  readonly label = saleLabel;
  ingredientNames(){return this.sale()?.lines.flatMap(line=>line.ingredients) ?? [];}
  private readonly api = inject(BffApi);
  readonly sale = signal<Sale | null>(null);
  readonly locations = signal<Location[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  private id = '';
  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((params) => {
        this.id = params.get('id') ?? '';
        void this.load();
      });
  }
  location() {
    return (
      this.locations().find((l) => l.id === this.sale()?.locationId)?.name ??
      'Unavailable location'
    );
  }
  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [sale, locations] = await Promise.all([
        this.api.getSale(this.id),
        this.api.listLocations(),
      ]);
      this.sale.set(sale);
      this.locations.set(locations.items);
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.loading.set(false);
    }
  }
  async cancel() {
    const sale = this.sale();
    if (!sale || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.sale.set(await this.api.cancelSale(sale.id, sale.version));
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
