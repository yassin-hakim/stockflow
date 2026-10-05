import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BffApi, describeError } from '../core/bff-api';

@Component({ selector: 'app-product-create', imports: [ReactiveFormsModule, RouterLink], template: `
  <div class="page-head"><div><h1>Create product</h1><p class="muted">New products start with zero stock.</p></div><a routerLink="/inventory">Back to inventory</a></div>
  <form class="panel" [formGroup]="form" (ngSubmit)="submit()" novalidate>
    <div class="field"><label for="name">Product name</label><input id="name" formControlName="name" maxlength="100" required [attr.aria-invalid]="validation() && invalidName() ? 'true' : null" [attr.aria-describedby]="validation() && invalidName() ? 'name-error' : null"><small>Required, up to 100 characters.</small>@if (validation() && invalidName()) { <small class="error" id="name-error">Enter a product name of 1–100 characters.</small> }</div>
    <div class="grid-2"><div class="field"><label for="unit">Unit</label><input id="unit" formControlName="unit" maxlength="20" placeholder="kg" required [attr.aria-invalid]="validation() && invalidUnit() ? 'true' : null" [attr.aria-describedby]="validation() && invalidUnit() ? 'unit-error' : null"><small>For example kg, L or pcs.</small>@if (validation() && invalidUnit()) { <small class="error" id="unit-error">Enter a unit of 1–20 characters.</small> }</div>
    <div class="field"><label for="category">Category</label><input id="category" formControlName="category" maxlength="80" required [attr.aria-invalid]="validation() && invalidCategory() ? 'true' : null" [attr.aria-describedby]="validation() && invalidCategory() ? 'category-error' : null">@if (validation() && invalidCategory()) { <small class="error" id="category-error">Enter a category of 1–80 characters.</small> }</div></div>
    <div class="field"><label for="threshold">Low-stock threshold</label><input id="threshold" type="number" min="0" max="1000000000" step="0.001" formControlName="lowStockThreshold" [attr.aria-invalid]="validation() && invalidThreshold() ? 'true' : null" [attr.aria-describedby]="validation() && invalidThreshold() ? 'threshold-error' : null"><small>Optional. Zero disables the LOW status.</small>@if (validation() && invalidThreshold()) { <small class="error" id="threshold-error">Use 0–1,000,000,000 with at most three decimals.</small> }</div>
    @if (validation()) { <p class="error" role="alert" tabindex="-1" id="product-validation">{{ validation() }}</p> }
    @if (error()) { <p class="error" role="alert" tabindex="-1" id="product-error">{{ error() }}</p> }
    @if (uncertain()) { <p><a routerLink="/inventory">Check inventory for the product</a> before starting another creation attempt.</p> }
    <button type="submit" [disabled]="submitting() || uncertain()">{{ submitting() ? 'Creating…' : 'Create product' }}</button>
  </form>
` })
export class ProductCreate {
  private readonly api = inject(BffApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly validation = signal('');
  readonly uncertain = signal(false);
  readonly form = this.fb.nonNullable.group({ name: ['', [Validators.required, Validators.maxLength(100)]], unit: ['', [Validators.required, Validators.maxLength(20)]], category: ['', [Validators.required, Validators.maxLength(80)]], lowStockThreshold: [0] });
  invalidName(): boolean { const value = this.form.value.name?.trim() ?? ''; return value.length < 1 || value.length > 100; }
  invalidUnit(): boolean { const value = this.form.value.unit?.trim() ?? ''; return value.length < 1 || value.length > 20; }
  invalidCategory(): boolean { const value = this.form.value.category?.trim() ?? ''; return value.length < 1 || value.length > 80; }
  invalidThreshold(): boolean { const scaled = Number(this.form.value.lowStockThreshold ?? 0) * 1000; return !Number.isFinite(scaled) || scaled < 0 || scaled > 1_000_000_000_000 || Math.abs(scaled - Math.round(scaled)) > 0.00001; }
  async submit(): Promise<void> {
    if (this.submitting() || this.uncertain()) return;
    this.validation.set(''); this.error.set('');
    const body = { name: this.form.value.name?.trim() ?? '', unit: this.form.value.unit?.trim() ?? '', category: this.form.value.category?.trim() ?? '', lowStockThreshold: Number(this.form.value.lowStockThreshold ?? 0) };
    const scaled = body.lowStockThreshold * 1000;
    if (this.form.invalid || this.invalidName() || this.invalidUnit() || this.invalidCategory() || !Number.isFinite(scaled) || scaled < 0 || scaled > 1_000_000_000_000 || Math.abs(scaled - Math.round(scaled)) > 0.00001) { this.validation.set('Check the highlighted fields and use a threshold with at most three decimal places.'); setTimeout(() => document.getElementById('product-validation')?.focus(), 0); return; }
    this.submitting.set(true);
    try { const product = await this.api.createProduct(body); await this.router.navigate(['/products', product.id]); }
    catch (error) { const failure = describeError(error); this.uncertain.set(['NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(failure.code)); this.error.set(this.uncertain() ? 'Creation outcome is uncertain. Check inventory for the product before another attempt.' : failure.message); setTimeout(() => document.getElementById('product-error')?.focus(), 0); }
    finally { this.submitting.set(false); }
  }
}
