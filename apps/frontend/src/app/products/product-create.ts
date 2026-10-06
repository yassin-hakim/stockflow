import { ReadableText } from '../shared/readable-text';
import { quantityMillis } from '@stockflow/primitives';
import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Product } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';

@Component({
  selector: 'app-product-create',
  imports: [ReadableText, ReactiveFormsModule, RouterLink],
  templateUrl: './product-create.html',
})
export class ProductCreate {
  private readonly api = inject(BffApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
  readonly product = signal<Product | null>(null);
  readonly loading = signal(false);
  readonly confirmingArchive = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly validation = signal('');
  readonly uncertain = signal(false);
  readonly refreshNeeded = signal(false);
  readonly reviewRequired = signal(false);
  readonly reviewLoaded = signal(false);
  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    unit: ['', [Validators.required, Validators.maxLength(20)]],
    category: ['', [Validators.required, Validators.maxLength(80)]],
    lowStockThreshold: [0],
    sku: ['', [Validators.maxLength(50), Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/)]],
  });
  constructor() { if (this.id) void this.load(); }
  async load(): Promise<void> {
    if (!this.id) return;
    this.loading.set(true); this.error.set('');
    try {
      const product = await this.api.getProduct(this.id);
      this.product.set(product);
      this.form.patchValue({ name: product.name, unit: product.unit, category: product.category, lowStockThreshold: product.lowStockThreshold, sku: product.sku ?? '' });
      this.form.controls.unit.disable();
    } catch (error) { this.error.set(describeError(error).message); }
    finally { this.loading.set(false); }
  }
  async archive(): Promise<void> {
    const product = this.product();
    if (!product || this.submitting() || this.uncertain() || this.refreshNeeded() || this.reviewRequired()) return;
    this.submitting.set(true); this.error.set('');
    try {
      this.product.set(await this.api.archiveProduct(product.id, product.version ?? 0));
      this.confirmingArchive.set(false);
      await this.router.navigate(['/products', product.id]);
    } catch (error) {const failure=describeError(error);this.refreshNeeded.set(failure.code==='VERSION_CONFLICT'); this.error.set(failure.message); }
    finally { this.submitting.set(false); }
  }
  async checkOutcome(): Promise<void> {
    if (!this.id || this.submitting()) return;
    this.submitting.set(true);
    try {
      const product = await this.api.getProduct(this.id);
      const value = this.form.getRawValue();
      if (product.name === value.name.trim() && product.category === value.category.trim() && product.lowStockThreshold === Number(value.lowStockThreshold) && (product.sku ?? '') === value.sku.trim().toUpperCase()) {
        await this.router.navigate(['/products', this.id]);
      } else {
        this.product.set(product); this.uncertain.set(false);
        this.error.set('The latest product is loaded. Your entered values are preserved; review them before saving.');
      }
    } catch (error) { this.error.set(describeError(error).message); }
    finally { this.submitting.set(false); }
  }
  async refreshCurrent(): Promise<void> {
    if (!this.id || this.submitting() || this.uncertain()) return;
    this.submitting.set(true);
    try {
      this.product.set(await this.api.getProduct(this.id));
      this.refreshNeeded.set(false);
      this.reviewRequired.set(true);
      this.reviewLoaded.set(true);
      this.error.set('The latest saved product is loaded. Your entered values are preserved. Review them against the saved values before another save.');
      setTimeout(()=>document.getElementById('product-conflict-review')?.focus(),0);
    }catch(error){this.error.set(describeError(error).message);}
    finally{this.submitting.set(false);}
  }
  invalidName(): boolean {
    const value = this.form.value.name?.trim() ?? '';
    return value.length < 1 || value.length > 100;
  }
  invalidUnit(): boolean {
    const value = this.form.value.unit?.trim() ?? '';
    return value.length < 1 || value.length > 20;
  }
  invalidCategory(): boolean {
    const value = this.form.value.category?.trim() ?? '';
    return value.length < 1 || value.length > 80;
  }
  invalidThreshold(): boolean {
    return quantityMillis(this.form.value.lowStockThreshold ?? 0, true) === null;
  }
  async submit(): Promise<void> {
    if (this.submitting() || this.uncertain() || this.refreshNeeded() || this.reviewRequired()) return;
    this.validation.set('');
    this.error.set('');
    const value = this.form.getRawValue();
    const body = {
      name: this.form.value.name?.trim() ?? '',
      unit: value.unit.trim(),
      category: this.form.value.category?.trim() ?? '',
      lowStockThreshold: Number(this.form.value.lowStockThreshold ?? 0),
      sku: value.sku.trim().toUpperCase() || null,
    };
    if (
      this.form.invalid ||
      this.invalidName() ||
      (!this.id && this.invalidUnit()) ||
      this.invalidCategory() ||
      this.invalidThreshold()
    ) {
      this.validation.set(
        'Check the highlighted fields and use a threshold with at most three decimal places.',
      );
      setTimeout(() => document.getElementById('product-validation')?.focus(), 0);
      return;
    }
    this.submitting.set(true);
    try {
      const product = this.id
        ? await this.api.editProduct(this.id, { name: body.name, category: body.category, lowStockThreshold: body.lowStockThreshold, sku: body.sku, expectedVersion: this.product()?.version ?? 0 })
        : await this.api.createProduct(body);
      await this.router.navigate(['/products', product.id]);
    } catch (error) {
      const failure = describeError(error);
      this.refreshNeeded.set(failure.code === 'VERSION_CONFLICT');
      this.uncertain.set(
        ['NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(failure.code),
      );
      this.error.set(
        this.uncertain()
          ? (this.id ? 'Saving outcome is uncertain. Check the saved product before another attempt.' : 'Creation outcome is uncertain. Check inventory for the product before another attempt.')
          : failure.message,
      );
      setTimeout(() => document.getElementById('product-error')?.focus(), 0);
    } finally {
      this.submitting.set(false);
    }
  }
}
