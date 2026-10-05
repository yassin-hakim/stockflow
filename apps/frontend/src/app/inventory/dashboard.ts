import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { InventoryOverview } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';

@Component({ selector: 'app-dashboard', imports: [RouterLink], template: `
  <div class="page-head"><div><h1>Inventory</h1><p class="muted">Current stock across your products</p></div><a class="button" routerLink="/products/new">Create product</a></div>
  @if (loading()) { <p role="status">Loading inventory…</p> }
  @else if (error()) { <div class="error" role="alert">{{ error() }}</div><p><button type="button" (click)="load()">Retry</button></p> }
  @else if (items().length === 0) { <section class="panel"><h2>No products yet</h2><p>Create a product to start tracking stock.</p><a routerLink="/products/new">Create product</a></section> }
  @else {
    <div class="panel table-wrap desktop-table"><table><thead><tr><th scope="col">Product</th><th scope="col">Category</th><th scope="col">Stock</th><th scope="col">Status</th></tr></thead><tbody>
      @for (row of items(); track row.product.id) { <tr><td><a [routerLink]="['/products',row.product.id]">{{ row.product.name }}</a></td><td>{{ row.product.category }}</td><td>{{ row.quantity }} {{ row.product.unit }}</td><td><span class="status" [class]="'status ' + row.status">{{ row.status }}</span></td></tr> }
    </tbody></table></div>
    <div class="stack mobile-list">@for (row of items(); track row.product.id) { <article class="panel"><h2><a [routerLink]="['/products',row.product.id]">{{ row.product.name }}</a></h2><p>{{ row.product.category }}</p><p><strong>{{ row.quantity }} {{ row.product.unit }}</strong> <span class="status" [class]="'status ' + row.status">{{ row.status }}</span></p></article> }</div>
  }
` })
export class Dashboard {
  private readonly api = inject(BffApi);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly items = signal<InventoryOverview[]>([]);
  constructor() { void this.load(); }
  async load(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try { this.items.set((await this.api.listInventory()).items); }
    catch (error) { this.error.set(describeError(error).message); }
    finally { this.loading.set(false); }
  }
}
