import { Pagination, Paging } from '../shared/pagination';
import { ReadableText } from '../shared/readable-text';
import { SectionNav } from '../shared/section-nav';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { InventoryOverview, Location } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';

@Component({ selector: 'app-dashboard', imports: [Pagination, ReadableText, SectionNav, RouterLink], templateUrl: './dashboard.html' })
export class Dashboard {
  readonly pager = new Paging();
  private readonly api = inject(BffApi);
  private readonly route = inject(ActivatedRoute);
  private generation = 0;
  readonly locations = signal<Location[]>([]);
  readonly locationId = signal(this.route.snapshot.paramMap.get('id') ?? this.route.snapshot.queryParamMap.get('location') ?? '');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly items = signal<InventoryOverview[]>([]);
  readonly query = signal('');
  readonly category = signal('');
  readonly status = signal('');
  readonly showArchived = signal(false);
  readonly categories = computed(() => [...new Set(this.items().map(row => row.product.category))].sort());
  readonly filtered = computed(() => this.items().filter(row =>
    (this.showArchived() || !row.product.archivedAt) &&
    (!this.category() || row.product.category === this.category()) &&
    (!this.status() || row.status === this.status()) &&
    `${row.product.name} ${row.product.sku ?? ''}`.toLowerCase().includes(this.query().trim().toLowerCase())
  ));
  constructor() {
    void this.load();
  }
  async load(): Promise<void> {
    this.pager.reset();
    this.loading.set(true);
    this.error.set('');
    const generation=++this.generation;
    try {
      const [locations,stock]=await Promise.all([this.api.listLocations(),this.api.listStock(this.locationId()||undefined)]);
      if(generation!==this.generation)return;
      this.locations.set(locations.items);this.items.set(stock.items);
    } catch (error) {
      if(generation===this.generation)this.error.set(describeError(error).message);
    } finally {
      if(generation===this.generation)this.loading.set(false);
    }
  }
}
