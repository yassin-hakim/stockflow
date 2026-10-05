import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { InventoryOverview } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';

@Component({ selector: 'app-dashboard', imports: [RouterLink], templateUrl: './dashboard.html' })
export class Dashboard {
  private readonly api = inject(BffApi);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly items = signal<InventoryOverview[]>([]);
  constructor() {
    void this.load();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.items.set((await this.api.listInventory()).items);
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
