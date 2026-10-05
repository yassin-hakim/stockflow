import { quantityMillis } from '@stockflow/primitives';
import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BffApi, describeError } from '../core/bff-api';

@Component({
  selector: 'app-product-create',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './product-create.html',
})
export class ProductCreate {
  private readonly api = inject(BffApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly validation = signal('');
  readonly uncertain = signal(false);
  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    unit: ['', [Validators.required, Validators.maxLength(20)]],
    category: ['', [Validators.required, Validators.maxLength(80)]],
    lowStockThreshold: [0],
  });
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
    if (this.submitting() || this.uncertain()) return;
    this.validation.set('');
    this.error.set('');
    const body = {
      name: this.form.value.name?.trim() ?? '',
      unit: this.form.value.unit?.trim() ?? '',
      category: this.form.value.category?.trim() ?? '',
      lowStockThreshold: Number(this.form.value.lowStockThreshold ?? 0),
    };
    if (
      this.form.invalid ||
      this.invalidName() ||
      this.invalidUnit() ||
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
      const product = await this.api.createProduct(body);
      await this.router.navigate(['/products', product.id]);
    } catch (error) {
      const failure = describeError(error);
      this.uncertain.set(
        ['NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(failure.code),
      );
      this.error.set(
        this.uncertain()
          ? 'Creation outcome is uncertain. Check inventory for the product before another attempt.'
          : failure.message,
      );
      setTimeout(() => document.getElementById('product-error')?.focus(), 0);
    } finally {
      this.submitting.set(false);
    }
  }
}
