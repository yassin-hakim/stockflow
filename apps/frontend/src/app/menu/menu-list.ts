import { Pagination, Paging } from '../shared/pagination';
import { ReadableText } from '../shared/readable-text';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MenuItem } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
import { money } from './menu-money';

@Component({ selector: 'app-menu-list', imports: [Pagination, ReadableText, RouterLink], templateUrl: './menu-list.html', styleUrl: './menu.css' })
export class MenuList {
  readonly pager = new Paging();
  private readonly api = inject(BffApi);
  readonly items = signal<MenuItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly query = signal('');
  readonly category = signal('');
  readonly status = signal('ACTIVE');
  readonly categories = computed(() => [...new Set(this.items().map(item => item.category))].sort());
  readonly filtered = computed(() => this.items().filter(item =>
    (!this.category() || item.category === this.category()) &&
    (this.status() === 'ALL' || (this.status() === 'ARCHIVED' ? !!item.archivedAt : !item.archivedAt)) &&
    item.name.toLowerCase().includes(this.query().trim().toLowerCase())
  ));
  readonly money = money;
  constructor() { void this.load(); }
  async load(): Promise<void> {
    this.pager.reset();
    this.loading.set(true); this.error.set('');
    try { this.items.set((await this.api.listMenuItems()).items); }
    catch (error) { this.error.set(describeError(error).message); }
    finally { this.loading.set(false); }
  }
  resetFilters(): void { this.pager.reset(); this.query.set(''); this.category.set(''); this.status.set('ALL'); }
}
