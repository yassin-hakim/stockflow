import { Pagination, Paging } from '../shared/pagination';
import { saleLabel } from '../shared/record-labels';
import { ReadableText } from '../shared/readable-text';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime } from 'rxjs';
import type { Location, MenuItem, Sale, SaleCartLine } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
import { PendingSales, type PendingSaleCommand } from './pending-sales';
import { createStockRequestKey } from '../core/stock-request-key';
@Component({
  selector: 'app-pos',
  imports: [Pagination, ReadableText, ReactiveFormsModule, RouterLink, CurrencyPipe],
  templateUrl: './pos.html',
  styleUrl: './sales.css',
})
export class Pos {
  readonly pager = new Paging();
  readonly label = saleLabel;
  ingredientNames(){return this.draft()?.lines.flatMap(line=>line.ingredients) ?? this.menu().flatMap(item=>item.ingredients);}
  private readonly api = inject(BffApi);
  private readonly recovery = inject(PendingSales);
  private readonly fb = inject(FormBuilder);
  private readonly priceChanges = new Subject<void>();
  private cartSignature = '';
  private destroyed = false;
  readonly menu = signal<MenuItem[]>([]);
  readonly locations = signal<Location[]>([]);
  readonly search = signal('');
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly pricing = signal(false);
  readonly priceQueued = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly draft = signal<Sale | null>(null);
  readonly reviewed = signal(false);
  readonly pending = signal<PendingSaleCommand | null>(null);
  readonly storageError = signal('');
  readonly form = this.fb.nonNullable.group({
    locationId: ['', Validators.required],
    tender: ['CASH' as 'CASH' | 'CARD'],
    lines: this.fb.array<ReturnType<Pos['line']>>([]),
  });
  readonly available = computed(() =>
    this.menu().filter(
      (i) =>
        !i.archivedAt &&
        `${i.name} ${i.category}`.toLowerCase().includes(this.search().toLowerCase()),
    ),
  );
  readonly locked = computed(
    () =>
      this.busy() ||
      (!!this.pending() && !this.pricing()) ||
      !!this.storageError() ||
      this.draft()?.status === 'CHECKOUT_PENDING',
  );
  get lines() {
    return this.form.controls.lines;
  }
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
    this.priceChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe(() => {
      void this.refreshPrices();
    });
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const current = this.signature();
      if (current !== this.cartSignature) {
        this.cartSignature = current;
        this.message.set('');
        this.queuePrices();
      }
    });
    void this.load();
  }
  private signature() {
    const { locationId, lines } = this.form.getRawValue();
    return JSON.stringify({ locationId, lines });
  }
  private queuePrices() {
    this.reviewed.set(false);
    if (this.destroyed || this.loading() || this.locked() || this.draft()?.status === 'COMPLETED')
      return;
    this.priceQueued.set(true);
    this.priceChanges.next();
  }
  line(menuItemId: string, quantity = 1) {
    return this.fb.nonNullable.group({
      menuItemId: [menuItemId, Validators.required],
      quantity: [quantity, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]],
    });
  }
  async load() {
    this.pager.reset();
    this.loading.set(true);
    this.error.set('');
    this.storageError.set('');
    try {
      const [menu, locations] = await Promise.all([
        this.api.listMenuItems(),
        this.api.listLocations(),
      ]);
      this.menu.set(menu.items);
      this.locations.set(locations.items);
      if (!this.form.controls.locationId.value && locations.items[0])
        this.form.controls.locationId.setValue(locations.items[0].id, { emitEvent: false });
      try {
        const pending = this.recovery.get();
        this.pending.set(pending);
        const id = pending?.saleId ?? this.recovery.draft();
        if (id) {
          this.restore(await this.api.getSale(id));
        } else if (pending?.kind === 'CREATE') {
          this.form.controls.locationId.setValue(String(pending.body['locationId']), {
            emitEvent: false,
          });
          this.restoreLines(pending.body['lines'] as SaleCartLine[]);
        }
      } catch (error) {
        if (error instanceof HttpErrorResponse) throw error;
        this.storageError.set(
          error instanceof Error ? error.message : 'Saved sale could not be recovered.',
        );
      }
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.loading.set(false);
      this.cartSignature = this.signature();
      if (this.draft() && ['DRAFT', 'REJECTED'].includes(this.draft()!.status)) this.queuePrices();
    }
  }
  private restoreLines(lines: SaleCartLine[]) {
    this.lines.clear({ emitEvent: false });
    for (const line of lines)
      this.lines.push(this.line(line.menuItemId, line.quantity), { emitEvent: false });
  }
  private restore(sale: Sale) {
    this.draft.set(sale);
    this.form.controls.locationId.setValue(sale.locationId, { emitEvent: false });
    if (sale.tender) this.form.controls.tender.setValue(sale.tender, { emitEvent: false });
    this.restoreLines(sale.lines);
    this.cartSignature = this.signature();
    this.reviewed.set(sale.status === 'DRAFT');
    if (sale.status === 'COMPLETED' || sale.status === 'REJECTED' || sale.status === 'CANCELLED') {
      const pending = this.pending();
      if (pending && pending.kind !== 'REFUND') {
        this.recovery.clear(pending.key);
        this.pending.set(null);
      }
    }
  }
  add(item: MenuItem) {
    if (this.locked() || this.draft()?.status === 'COMPLETED') return;
    const existing = this.lines.controls.find((l) => l.controls.menuItemId.value === item.id);
    if (existing) existing.controls.quantity.setValue(existing.controls.quantity.value + 1);
    else this.lines.push(this.line(item.id));
    this.reviewed.set(false);
  }
  remove(index: number) {
    if (!this.locked() && this.draft()?.status !== 'COMPLETED') {
      this.lines.removeAt(index);
      this.reviewed.set(false);
    }
  }
  name(id: string) {
    return (
      this.menu().find((i) => i.id === id)?.name ??
      this.draft()?.lines.find((i) => i.menuItemId === id)?.name ??
      'Menu item'
    );
  }
  itemCount() {
    return this.lines
      .getRawValue()
      .reduce(
        (sum, line) =>
          sum + (Number.isSafeInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0),
        0,
      );
  }
  async refreshPrices() {
    if (
      this.locked() ||
      this.pricing() ||
      this.loading() ||
      this.destroyed ||
      this.draft()?.status === 'COMPLETED'
    )
      return;
    this.priceQueued.set(false);
    this.error.set('');
    this.reviewed.set(false);
    if (this.lines.length && this.form.invalid) return;
    const submitted = this.signature();
    this.pricing.set(true);
    try {
      const value = this.form.getRawValue(),
        draft = this.draft();
      if (!value.lines.length) {
        if (draft && ['DRAFT', 'REJECTED'].includes(draft.status)) {
          await this.api.cancelSale(draft.id, draft.version);
          this.recovery.saveDraft(null);
          this.draft.set(null);
        }
      } else if (draft && ['DRAFT', 'REJECTED'].includes(draft.status)) {
        let sale: Sale;
        try {
          sale = await this.api.editSale(draft.id, {
            expectedVersion: draft.version,
            locationId: value.locationId,
            lines: value.lines,
          });
        } catch (error) {
          // A lost PATCH response may already have saved the draft. Read its version before retrying.
          if (describeError(error).code !== 'VERSION_CONFLICT') throw error;
          const current = await this.api.getSale(draft.id);
          this.draft.set(current);
          if (!['DRAFT', 'REJECTED'].includes(current.status)) throw error;
          sale = await this.api.editSale(draft.id, {
            expectedVersion: current.version,
            locationId: value.locationId,
            lines: value.lines,
          });
        }
        this.draft.set(sale);
      } else {
        const command: PendingSaleCommand = {
          kind: 'CREATE',
          key: createStockRequestKey(),
          body: { locationId: value.locationId, lines: value.lines },
        };
        this.saveCommand(command);
        this.pending.set(command);
        await this.sendCreate(command, true);
      }
      // Never overwrite newer input or enable checkout for an older response.
      this.reviewed.set(
        !!value.lines.length && submitted === this.signature() && this.draft()?.status === 'DRAFT',
      );
    } catch (error) {
      this.error.set(describeError(error).message);
      this.clearRejectedCreate(error);
    } finally {
      this.pricing.set(false);
      this.priceQueued.set(false);
      if (submitted !== this.signature()) this.queuePrices();
    }
  }
  private clearRejectedCreate(error: unknown) {
    const code = describeError(error).code;
    const pending = this.pending();
    if (
      pending?.kind === 'CREATE' &&
      [
        'MENU_ITEM_UNAVAILABLE',
        'PRODUCT_ARCHIVED',
        'CURRENCY_MISMATCH',
        'INVALID_REQUEST',
        'INVALID_RECIPE',
      ].includes(code)
    ) {
      this.recovery.clear(pending.key);
      this.pending.set(null);
    }
  }
  private async sendCreate(command: PendingSaleCommand, preserveCart = false) {
    const sale = await this.api.createSale(
      command.body as unknown as { locationId: string; lines: SaleCartLine[] },
      command.key,
    );
    try {
      this.recovery.saveDraft(sale.id);
    } catch (error) {
      this.storageError.set(
        'The sale was saved, but browser recovery storage could not retain its reference. Resolve the saved creation command.',
      );
      throw error;
    }
    this.recovery.clear(command.key);
    this.pending.set(null);
    if (preserveCart) this.draft.set(sale);
    else this.restore(sale);
  }
  async checkout() {
    if (
      this.locked() ||
      this.pricing() ||
      this.priceQueued() ||
      this.form.invalid ||
      !this.lines.length ||
      !this.reviewed() ||
      this.draft()?.status !== 'DRAFT'
    )
      return;
    const sale = this.draft()!;
    const command: PendingSaleCommand = {
      kind: 'CHECKOUT',
      key: createStockRequestKey(),
      saleId: sale.id,
      body: {
        expectedVersion: sale.version,
        tender: this.form.controls.tender.value,
        locationId: sale.locationId,
      },
    };
    this.error.set('');
    this.busy.set(true);
    let refresh = false;
    try {
      this.saveCommand(command);
      this.pending.set(command);
      await this.sendCheckout(command);
    } catch (error) {
      const described = describeError(error);
      this.error.set(described.message);
      if (
        [
          'PRICE_REVIEW_REQUIRED',
          'VERSION_CONFLICT',
          'MENU_ITEM_UNAVAILABLE',
          'PRODUCT_ARCHIVED',
          'INVALID_SALE_STATE',
          'INVALID_REQUEST',
          'CURRENCY_MISMATCH',
        ].includes(described.code)
      ) {
        this.recovery.clear(command.key);
        this.pending.set(null);
        this.reviewed.set(false);
        refresh =
          described.code === 'PRICE_REVIEW_REQUIRED' || described.code === 'VERSION_CONFLICT';
      }
    } finally {
      this.busy.set(false);
      if (refresh) {
        this.queuePrices();
        this.message.set(
          'Prices changed. Updating the total; check it before completing the sale again.',
        );
      }
    }
  }
  private saveCommand(command: PendingSaleCommand) {
    try {
      this.recovery.save(command);
    } catch (error) {
      this.storageError.set(
        error instanceof Error
          ? error.message
          : 'The sale command could not be saved for recovery.',
      );
      throw error;
    }
  }
  private async sendCheckout(command: PendingSaleCommand) {
    const sale = await this.api.checkoutSale(
      command.saleId!,
      command.body as unknown as {
        expectedVersion: number;
        tender: 'CASH' | 'CARD';
        locationId: string;
      },
      command.key,
    );
    this.restore(sale);
    if (sale.status === 'COMPLETED') this.message.set('Sale completed. Its receipt is ready.');
    else if (sale.status === 'REJECTED')
      this.error.set(
        sale.error?.message ??
          'Ingredient consumption was rejected. Review the cart after correcting stock.',
      );
  }
  async resolve() {
    const command = this.pending();
    if (this.busy() || this.pricing()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      if (command?.kind === 'CREATE') await this.sendCreate(command, true);
      else if (command?.kind === 'CHECKOUT') {
        const sale = await this.api.getSale(command.saleId!);
        this.restore(sale);
        if (sale.status === 'DRAFT' || sale.status === 'CHECKOUT_PENDING')
          await this.sendCheckout(command);
      } else if (this.draft()) this.restore(await this.api.getSale(this.draft()!.id));
    } catch (error) {
      this.error.set(describeError(error).message);
      this.clearRejectedCreate(error);
    } finally {
      this.busy.set(false);
      if (command?.kind === 'CREATE' && !this.pending()) this.queuePrices();
    }
  }
  async newSale() {
    if (this.locked() || this.pricing()) return;
    this.error.set('');
    try {
      const sale = this.draft();
      if (sale && ['DRAFT', 'REJECTED'].includes(sale.status))
        await this.api.cancelSale(sale.id, sale.version);
      this.recovery.saveDraft(null);
      this.draft.set(null);
      this.lines.clear();
      this.reviewed.set(false);
      this.message.set('');
    } catch (error) {
      this.error.set(describeError(error).message);
    }
  }
}
