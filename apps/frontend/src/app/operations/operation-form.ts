import { priceMinor, priceText } from '../menu/menu-money';
import { operationLabel } from '../shared/record-labels';
import { ReadableText } from '../shared/readable-text';
import { SectionNav } from '../shared/section-nav';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Location, Product, StockOperation, StockView, Supplier } from '@stockflow/contracts';
import { quantityMillis } from '@stockflow/primitives';
import { BffApi, describeError } from '../core/bff-api';
import { PendingOperations, type PendingOperation } from '../core/pending-operations';
import { createStockRequestKey } from '../core/stock-request-key';

@Component({
  selector: 'app-operation-form',
  imports: [ReadableText, SectionNav, ReactiveFormsModule, RouterLink],
  templateUrl: './operation-form.html',
})
export class OperationForm {
  private readonly api = inject(BffApi);
  private readonly fb = inject(FormBuilder);
  private readonly pending = inject(PendingOperations);
  readonly kind = inject(ActivatedRoute).snapshot.data['kind'] as PendingOperation['kind'];
  readonly title =
    this.kind === 'receipts'
      ? 'Receive delivery'
      : this.kind === 'transfers'
        ? 'Transfer stock'
        : 'Record waste';
  readonly form = this.fb.nonNullable.group({
    locationId: ['', Validators.required],
    destinationLocationId: [''],
    reason: ['', Validators.required],
    reference: ['', Validators.required],
    supplierId: [''],
    wasteCategory: ['SPOILAGE'],
    lines: this.fb.array([this.newLine()]),
  });
  readonly locations = signal<Location[]>([]);
  readonly products = signal<Product[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly currency = signal('');
  invalidCost(value:string){return priceMinor(value)===null;}
  readonly source = signal<StockView[]>([]);
  readonly sourceLoading = signal(false);
  readonly sourceError = signal('');
  readonly attempted = signal(false);
  private sourceGeneration = 0;
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly saved = signal<StockOperation | null>(null);
  readonly pendingRequest = signal<PendingOperation | null>(null);
  readonly recoveryBlocked = signal(false);
  readonly locked = computed(
    () => this.submitting() || !!this.pendingRequest() || this.recoveryBlocked(),
  );
  constructor() {
    this.form.controls.locationId.valueChanges
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => void this.loadSource());
    void this.load();
  }
  async loadSource() {
    if (this.kind === 'receipts') return;
    const id = this.form.controls.locationId.value,
      generation = ++this.sourceGeneration;
    this.source.set([]);
    this.sourceError.set('');
    if (!id) return;
    this.sourceLoading.set(true);
    try {
      const stock = await this.api.listStock(id);
      if (generation === this.sourceGeneration) this.source.set(stock.items);
    } catch (error) {
      if (generation === this.sourceGeneration) this.sourceError.set(describeError(error).message);
    } finally {
      if (generation === this.sourceGeneration) this.sourceLoading.set(false);
    }
  }
  available(id: string) {
    const stock = this.source().find((row) => row.product.id === id);
    return stock ? `${stock.quantity} ${stock.product.unit} available` : null;
  }
  get lines() {
    return this.form.controls.lines;
  }
  private newLine() {
    return this.fb.nonNullable.group({
      productId: ['', Validators.required],
      quantity: [0, Validators.required],
      unitCost: [''],
    });
  }
  addLine() {
    if (!this.locked() && this.lines.length < 100) this.lines.push(this.newLine());
  }
  removeLine(index: number) {
    if (!this.locked() && this.lines.length > 1) this.lines.removeAt(index);
  }
  unit(id: string) {
    return this.products().find((product) => product.id === id)?.unit ?? '';
  }
  label(operation:StockOperation){return operationLabel(operation,this.locations().find(row=>row.id===operation.locationId)?.name??'Unavailable location');}
  invalidQuantity(value:number){return quantityMillis(value)===null;}
  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [locations, products, suppliers, catalog] = await Promise.all([
        this.api.listLocations(),
        this.api.listProducts(),
        this.api.listSuppliers(),
        this.kind==='receipts'?this.api.receivingConfig():Promise.resolve({currency:''}),
      ]);
      this.suppliers.set(suppliers.items);
      this.currency.set(catalog.currency);
      this.recoveryBlocked.set(false);
      this.locations.set(locations.items);
      this.products.set(
        products.items.filter((product) => this.kind !== 'receipts' || !product.archivedAt),
      );
      const previous = this.pending.get();
      this.pendingRequest.set(previous);
      if (previous && previous.kind === this.kind) this.restore(previous);
      else if (!previous) this.form.controls.locationId.setValue(locations.items[0]?.id ?? '');
    } catch (error) {
      this.error.set(
        error instanceof Error && !('status' in error)
          ? error.message
          : describeError(error).message,
      );
      this.recoveryBlocked.set(true);
    } finally {
      this.loading.set(false);
    }
  }
  private restore(previous: PendingOperation) {
    const body = previous.body;
    this.form.patchValue({
      locationId: body['locationId'] as string,
      destinationLocationId: (body['destinationLocationId'] as string) ?? '',
      reason: body['reason'] as string,
      reference: body['reference'] as string,
      supplierId: (body['supplierId'] as string) ?? '',
      wasteCategory: (body['wasteCategory'] as string) ?? 'SPOILAGE',
    });
    this.lines.clear();
    for (const value of body['lines'] as { productId: string; quantity: number; unitCostMinor?:number }[]) {
      const line = this.newLine();
      line.setValue({productId:value.productId,quantity:value.quantity,unitCost:value.unitCostMinor===undefined?'':priceText(value.unitCostMinor)});
      this.lines.push(line);
    }
  }
  async checkStatus() {
    const previous = this.pendingRequest();
    if (!previous || this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      const result = await this.api.getOperation(previous.key);
      this.pending.clear(previous.key);
      this.pendingRequest.set(null);
      if (result.status === 'COMMITTED') this.saved.set(result);
      else this.error.set(result.error?.message ?? 'The stock operation was rejected.');
    } catch (error) {
      const failure = describeError(error);
      this.error.set(
        failure.code === 'OPERATION_NOT_FOUND'
          ? 'The operation is not recorded yet. Retry the original request to resolve it safely.'
          : failure.message,
      );
    } finally {
      this.submitting.set(false);
    }
  }
  async submit() {
    if (this.submitting() || this.recoveryBlocked()) return;
    const previous = this.pendingRequest();
    if (previous && previous.kind !== this.kind) {
      this.error.set('Resolve the saved operation on its original page first.');
      return;
    }
    this.error.set('');
    this.saved.set(null);
    this.attempted.set(true);
    this.form.markAllAsTouched();
    const value = this.form.getRawValue();
    if (
      !previous &&
      (this.form.invalid ||
        !value.reason.trim() ||
        !value.reference.trim() ||
        value.lines.some((line) => quantityMillis(line.quantity) === null || (this.kind==='receipts' && this.invalidCost(line.unitCost))) ||
        (this.kind === 'transfers' &&
          (!value.destinationLocationId || value.destinationLocationId === value.locationId)))
    ) {
      this.error.set(
        this.kind==='receipts'?'Check products, quantities and costs, and enter a reason, reference and valid location.':'Check products and positive quantities, enter a reason and reference, and choose valid locations.',
      );
      const line=value.lines.findIndex(row=>!row.productId||quantityMillis(row.quantity)===null||(this.kind==='receipts'&&this.invalidCost(row.unitCost)));
      const field=!value.locationId?'operation-location':this.kind==='transfers'&&(!value.destinationLocationId||value.destinationLocationId===value.locationId)?'operation-destination':!value.reference.trim()?'operation-reference':line>=0?`${!value.lines[line].productId?'product':quantityMillis(value.lines[line].quantity)===null?'quantity':'cost'}-${line}`:'operation-reason';
      setTimeout(()=>document.getElementById(field)?.focus(),0);
      return;
    }
    const body: Record<string, unknown> = previous?.body ?? {
      locationId: value.locationId,
      lines: value.lines.map(line=>({productId:line.productId,quantity:line.quantity,...(this.kind==='receipts'?{unitCostMinor:priceMinor(line.unitCost)}:{})})),
      reason: value.reason.trim(),
      reference: value.reference.trim(),
      ...(this.kind === 'transfers' ? { destinationLocationId: value.destinationLocationId } : {}),
      ...(this.kind === 'receipts' && value.supplierId ? { supplierId: value.supplierId } : {}),
      ...(this.kind === 'waste' ? { wasteCategory: value.wasteCategory } : {}),
    };
    const request: PendingOperation = previous ?? {
      kind: this.kind,
      key: createStockRequestKey(),
      body,
    };
    try {
      this.pending.save(request);
      this.pendingRequest.set(request);
    } catch {
      this.recoveryBlocked.set(true);
      this.error.set(
        'The request identity could not be saved. Restore browser storage before submitting.',
      );
      return;
    }
    this.submitting.set(true);
    try {
      const result = await this.api.executeOperation(this.kind, body, request.key);
      this.pending.clear(request.key);
      this.pendingRequest.set(null);
      this.saved.set(result);
    } catch (error) {
      const failure = describeError(error);
      if (
        ![
          'NETWORK_ERROR',
          'UPSTREAM_UNAVAILABLE',
          'SERVICE_UNAVAILABLE',
          'INTERNAL_ERROR',
        ].includes(failure.code)
      ) {
        this.pending.clear(request.key);
        this.pendingRequest.set(null);
      }
      this.error.set(failure.message);
    } finally {
      this.submitting.set(false);
    }
  }
  startNew() {
    if (!this.locked()) {
      this.saved.set(null);
      this.form.controls.reason.reset();
      this.form.controls.reference.reset();
      this.lines.clear();
      this.lines.push(this.newLine());
      this.attempted.set(false);
    }
  }
}
