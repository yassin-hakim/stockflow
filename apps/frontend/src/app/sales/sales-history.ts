import { Pagination, Paging } from '../shared/pagination';
import { saleLabel } from '../shared/record-labels';
import { ReadableText } from '../shared/readable-text';
import { Component, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Sale } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
@Component({
  selector: 'app-sales-history',
  imports: [Pagination, ReadableText, RouterLink, ReactiveFormsModule, CurrencyPipe, DatePipe],
  templateUrl: './sales-history.html',
  styleUrl: './sales.css',
})
export class SalesHistory {
  readonly pager = new Paging();
  async resizePage(size:number){this.pager.resize(size);await this.pageTo(1);}
  async pageTo(page:number) { await this.pager.go(page,()=>this.rows().length,()=>this.cursor() !== null,()=>this.load(true)); }

  readonly label = saleLabel;
  private readonly api = inject(BffApi);
  readonly form = inject(FormBuilder).nonNullable.group({ search: [''], status: [''] });
  private appliedFilters={search:'',status:''};
  readonly rows = signal<Sale[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly cursor = signal<string | null>(null);
  constructor() {
    void this.load();
  }
  async load(more = false) {
    if(!more) this.pager.reset();
    if (more && this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const filters = more?this.appliedFilters:this.form.getRawValue();
      const params: Record<string, string> = { limit: '25' };
      if (filters.search.trim()) params['search'] = filters.search.trim();
      if (filters.status) params['status'] = filters.status;
      if (more && this.cursor()) params['cursor'] = this.cursor()!;
      const result = await this.api.listSales(params);
      if(!more)this.appliedFilters=filters;
      this.rows.set(more ? [...this.rows(), ...result.items] : result.items);
      this.cursor.set(result.nextCursor);
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
