import { Pagination, Paging } from '../shared/pagination';
import { ReadableText } from '../shared/readable-text';
import { SectionNav } from '../shared/section-nav';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Location, ReplenishmentItem } from '@stockflow/contracts';
import { quantityMillis } from '@stockflow/primitives';
import { BffApi, describeError } from '../core/bff-api';
@Component({
  selector: 'app-replenishment',
  imports: [Pagination, ReadableText, SectionNav, ReactiveFormsModule, RouterLink],
  templateUrl: './replenishment.html',
})
export class Replenishment {
  readonly pager = new Paging();
  productNames(){return this.rows().map(row=>row.product);}
  private readonly api = inject(BffApi);
  private readonly route = inject(ActivatedRoute);
  readonly form = inject(FormBuilder).nonNullable.group({
    lowStockThreshold: [0, Validators.required],
    targetQuantity: [0, Validators.required],
  });
  readonly locations = signal<Location[]>([]);
  readonly locationId = signal('');
  readonly rows = signal<ReplenishmentItem[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly editing = signal<ReplenishmentItem | null>(null);
  constructor() {
    void this.loadLocations();
  }
  async loadLocations() {
    this.loading.set(true);
    this.error.set('');
    try {
      const locations = (await this.api.listLocations()).items;
      this.locations.set(locations);
      const desired = this.route.snapshot.queryParamMap.get('locationId');
      this.locationId.set(
        locations.some((item) => item.id === desired) ? desired! : (locations[0]?.id ?? ''),
      );
      await this.load();
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.loading.set(false);
    }
  }
  async load() {
    this.pager.reset();
    if (!this.locationId()) {
      this.rows.set([]);
      this.loading.set(false);
      return;
    }
    const requested = this.locationId();
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await this.api.listReplenishment(requested);
      if (requested === this.locationId()) this.rows.set(result.items);
    } catch (error) {
      if (requested === this.locationId()) this.error.set(describeError(error).message);
    } finally {
      if (requested === this.locationId()) this.loading.set(false);
    }
  }
  select(value: string) {
    if (this.busy()) return;
    this.locationId.set(value);
    this.editing.set(null);
    this.message.set('');
    void this.load();
  }
  edit(row: ReplenishmentItem) {
    if (this.busy()) return;
    this.editing.set(row);
    this.form.setValue({
      lowStockThreshold: row.lowStockThreshold,
      targetQuantity: row.targetQuantity ?? row.lowStockThreshold,
    });
    this.message.set('');
    queueMicrotask(() => document.getElementById('replenishment-threshold')?.focus());
  }
  cancel() {
    if (!this.busy()) this.editing.set(null);
  }
  async save() {
    const row = this.editing();
    if (!row || this.busy()) return;
    const value = this.form.getRawValue();
    this.error.set('');
    this.message.set('');
    if (
      this.form.invalid ||
      quantityMillis(value.lowStockThreshold, true) === null ||
      quantityMillis(value.targetQuantity, true) === null ||
      value.targetQuantity < value.lowStockThreshold
    ) {
      this.error.set(
        'Use nonnegative quantities with at most three decimals. Target must be at least the threshold.',
      );
      return;
    }
    this.busy.set(true);
    try {
      await this.api.saveReplenishment({
        ...value,
        productId: row.product.id,
        locationId: this.locationId(),
        expectedVersion: row.version ?? null,
      });
      this.editing.set(null);
      await this.load();
      this.message.set(
        'Replenishment policy saved. Suggested quantities were refreshed from stock.',
      );
    } catch (error) {
      this.error.set(describeError(error).message);
      queueMicrotask(() => document.getElementById('replenishment-error')?.focus());
    } finally {
      this.busy.set(false);
    }
  }
}
