import { ReadableText } from '../shared/readable-text';
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { quantityMillis } from '@stockflow/primitives';
import type { MenuItem, Product } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
import { money, priceMinor, priceText } from './menu-money';

@Component({ selector: 'app-menu-item-page', imports: [ReadableText, ReactiveFormsModule, RouterLink, DatePipe], templateUrl: './menu-item-page.html', styleUrl: './menu.css' })
export class MenuItemPage {
  private readonly api = inject(BffApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private generation = 0;
  readonly id = signal<string | null>(null);
  readonly item = signal<MenuItem | null>(null);
  readonly historical = signal<MenuItem | null>(null);
  readonly products = signal<Product[]>([]);
  readonly currency = signal('');
  readonly loading = signal(true);
  readonly catalogLoading = signal(false);
  readonly catalogError = signal('');
  readonly error = signal('');
  readonly validation = signal('');
  readonly success = signal('');
  readonly editing = signal(false);
  readonly submitting = signal(false);
  readonly uncertain = signal<'save' | 'archive' | null>(null);
  readonly confirmingArchive = signal(false);
  readonly revisionLoading = signal(false);
  readonly revisionError = signal('');
  readonly refreshNeeded = signal(false);
  readonly selectedRevision = signal(0);
  readonly revisionLookup = this.fb.nonNullable.control('',[Validators.required,Validators.pattern(/^\d+$/)]);
  readonly money = money;
  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    category: ['', [Validators.required, Validators.maxLength(80)]],
    price: ['', Validators.required],
    ingredients: this.fb.array([this.line()]),
  });
  get lines() { return this.form.controls.ingredients; }
  constructor() {
    inject(ActivatedRoute).paramMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(params => {
      this.id.set(params.get('id')); void this.load();
    });
  }
  private line(productId = '', quantity: number | null = null) {
    return this.fb.group({ productId: this.fb.nonNullable.control(productId, Validators.required), quantity: this.fb.control(quantity, Validators.required) });
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true); this.error.set(''); this.validation.set(''); this.success.set(''); this.historical.set(null); this.uncertain.set(null); this.confirmingArchive.set(false); this.refreshNeeded.set(false); this.item.set(null); this.currency.set('');
    this.form.enable();
    try {
      const id = this.id();
      if (id) {
        const item = await this.api.getMenuItem(id);
        if (generation !== this.generation) return;
        this.item.set(item); this.currency.set(item.currency); this.editing.set(false); this.populate(item); this.selectedRevision.set(item.recipeRevision);
      } else {
        const menu = await this.api.listMenuItems();
        if (generation !== this.generation) return;
        this.item.set(null); this.currency.set(menu.currency); this.editing.set(true); this.form.reset(); this.lines.clear(); this.lines.push(this.line());
      }
      await this.loadIngredients();
    } catch (error) { if (generation === this.generation) this.error.set(describeError(error).message); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  async loadIngredients(): Promise<void> {
    this.catalogLoading.set(true); this.catalogError.set('');
    try { this.products.set((await this.api.listProducts()).items); }
    catch (error) { this.catalogError.set(describeError(error).message); }
    finally { this.catalogLoading.set(false); }
  }
  activeProducts(): Product[] { return this.products().filter(product => !product.archivedAt); }
  product(productId: string): Product | undefined { return this.products().find(product => product.id === productId); }
  unit(productId: string): string { return this.product(productId)?.unit ?? this.item()?.ingredients.find(line => line.productId === productId)?.unit ?? ''; }
  unavailable(productId: string): boolean { const product = this.product(productId); return !product || !!product.archivedAt; }
  nameInvalid(): boolean { const name = this.form.controls.name.value.trim(); return !name || name.length > 100; }
  categoryInvalid(): boolean { const category = this.form.controls.category.value.trim(); return !category || category.length > 80; }
  priceInvalid(): boolean { return priceMinor(this.form.controls.price.value) === null; }
  ingredientInvalid(index: number): boolean { return this.unavailable(this.lines.at(index).controls.productId.value); }
  quantityInvalid(index: number): boolean { return quantityMillis(this.lines.at(index).controls.quantity.value) === null; }
  addLine(): void { if (!this.submitting() && !this.uncertain() && this.lines.length < 100) this.lines.push(this.line()); }
  removeLine(index: number): void { if (!this.submitting() && !this.uncertain() && this.lines.length > 1) this.lines.removeAt(index); }
  startEditing(): void {
    const item = this.item(); if (!item || item.archivedAt || this.submitting() || this.uncertain()) return;
    this.populate(item); this.historical.set(null); this.editing.set(true); this.error.set(''); this.success.set(''); this.validation.set('');
  }
  cancelEditing(): void { if (this.submitting() || this.uncertain()) return; this.editing.set(false); this.validation.set(''); this.error.set(''); }
  private populate(item: MenuItem): void {
    this.form.patchValue({ name: item.name, category: item.category, price: priceText(item.priceMinor) });
    this.lines.clear(); for (const ingredient of item.ingredients) this.lines.push(this.line(ingredient.productId, ingredient.quantity));
  }
  private body() {
    const value = this.form.getRawValue();
    return { name: value.name.trim(), category: value.category.trim(), priceMinor: priceMinor(value.price)!, currency: this.currency(), ingredients: value.ingredients.map(line => ({ productId: line.productId, quantity: line.quantity! })) };
  }
  async submit(): Promise<void> {
    if (this.loading() || this.item()?.archivedAt || this.refreshNeeded() || this.submitting() || this.uncertain() || this.catalogLoading() || this.catalogError()) return;
    this.error.set(''); this.validation.set(''); this.success.set(''); this.form.markAllAsTouched();
    if (this.form.invalid || this.nameInvalid() || this.categoryInvalid() || this.priceInvalid() || !this.currency() || !this.lines.length || this.lines.controls.some((_, index) => this.ingredientInvalid(index) || this.quantityInvalid(index))) {
      this.validation.set('Check the highlighted fields. Recipes need active ingredients and positive quantities with at most three decimals.'); this.focus('menu-validation'); return;
    }
    this.submitting.set(true); this.form.disable();
    try {
      const id = this.id(), body = this.body();
      const result = id ? await this.api.publishMenuItem(id, { ...body, expectedVersion: this.item()!.version }) : await this.api.createMenuItem(body);
      this.item.set(result); this.editing.set(false); this.selectedRevision.set(result.recipeRevision); this.populate(result);
      this.success.set(`Recipe revision ${result.recipeRevision} is published.`);
      if (!id) await this.router.navigate(['/menu', result.id]);
    } catch (error) {
      const failure = describeError(error);
      if (this.isUncertain(failure.code)) { this.uncertain.set('save'); this.error.set('Saving outcome is uncertain. Check the saved menu before another attempt.'); }
      else { this.error.set(failure.message); this.refreshNeeded.set(failure.code === 'VERSION_CONFLICT'); }
      this.focus('menu-error');
    } finally { this.submitting.set(false); if (!this.uncertain()) this.form.enable(); }
  }
  async archive(): Promise<void> {
    const item = this.item(); if (!item || this.submitting() || this.uncertain()) return;
    this.error.set(''); this.submitting.set(true); this.form.disable();
    try { this.item.set(await this.api.archiveMenuItem(item.id, item.version)); this.editing.set(false); this.confirmingArchive.set(false); this.success.set('Menu item archived. Existing sale and recipe history is preserved.'); }
    catch (error) {
      const failure = describeError(error);
      if (this.isUncertain(failure.code)) { this.uncertain.set('archive'); this.error.set('Archiving outcome is uncertain. Check the saved menu item.'); }
      else { this.error.set(failure.message); this.refreshNeeded.set(failure.code === 'VERSION_CONFLICT'); }
      this.focus('menu-error');
    } finally { this.submitting.set(false); if (!this.uncertain()) this.form.enable(); }
  }
  async checkOutcome(): Promise<void> {
    const id = this.id(), previous = this.item(); if (!id || !previous || this.submitting()) return;
    this.submitting.set(true);
    try {
      const current = await this.api.getMenuItem(id);
      if (this.uncertain() === 'archive' && current.archivedAt) {
        this.item.set(current); this.uncertain.set(null); this.confirmingArchive.set(false); this.editing.set(false); this.error.set(''); this.success.set('Menu item archived.');
      } else if (current.version > previous.version) {
        // A later committed version makes the original expectedVersion unable to
        // succeed again. Keep entered values for explicit review of any conflict.
        const requested = this.body();
        const allocations = new Map<string, number>();
        for (const line of requested.ingredients) allocations.set(line.productId, (allocations.get(line.productId) ?? 0) + (quantityMillis(line.quantity) ?? 0));
        const matches = !current.archivedAt && current.name === requested.name && current.category === requested.category && current.priceMinor === requested.priceMinor && current.currency === requested.currency && current.ingredients.length === allocations.size && current.ingredients.every(line => quantityMillis(line.quantity) === allocations.get(line.productId));
        this.item.set(current); this.uncertain.set(null); this.form.enable();
        if (current.archivedAt) { this.editing.set(false); this.error.set(''); this.success.set('The saved menu item is archived. Its history remains available.'); }
        else if (matches) { this.editing.set(false); this.populate(current); this.error.set(''); this.success.set(`Recipe revision ${current.recipeRevision} is published.`); }
        else { this.error.set('The saved menu item has changed. Your entered values are preserved; review them before publishing again.'); }
      } else this.error.set('The original outcome is still uncertain. Keep this request unchanged and check again.');
    } catch (error) { this.error.set(describeError(error).message); }
    finally { this.submitting.set(false); if (!this.uncertain()) this.form.enable(); }
  }
  async refreshCurrent(): Promise<void> {
    const id = this.id(); if (!id || this.submitting() || this.uncertain()) return;
    this.submitting.set(true);
    try {
      const current = await this.api.getMenuItem(id);
      this.item.set(current); this.refreshNeeded.set(false); this.selectedRevision.set(current.recipeRevision);
      if (current.archivedAt) this.editing.set(false);
      this.error.set(current.archivedAt ? 'This menu item has been archived.' : 'Latest saved revision loaded. Your entered values are preserved; review them before publishing.');
    } catch (error) { this.error.set(describeError(error).message); }
    finally { this.submitting.set(false); }
  }
  async showRevision(value: string): Promise<void> {
    const item = this.item(), revision = Number(value); if (!item || this.revisionLoading()) return;
    this.revisionError.set('');
    if(!Number.isSafeInteger(revision)||revision<1||revision>item.recipeRevision){this.revisionError.set(`Enter a whole revision number from 1 to ${item.recipeRevision}.`);return;}
    this.selectedRevision.set(revision); this.revisionLookup.setValue(String(revision));
    if (revision === item.recipeRevision) { this.historical.set(null); return; }
    this.revisionLoading.set(true);
    try { this.historical.set(await this.api.getMenuRevision(item.id, revision)); }
    catch (error) { this.historical.set(null); this.revisionError.set(describeError(error).message); }
    finally { this.revisionLoading.set(false); this.focus(this.revisionError()?'recipe-revision-error':'recipe-revision-detail'); }
  }
  revisionNumbers(): number[] { const max = this.item()?.recipeRevision ?? 0;const recent=Array.from({ length: Math.min(max, 100) }, (_, index) => max - index);const selected=this.selectedRevision();return selected>0&&!recent.includes(selected)?[...recent,selected]:recent; }
  private isUncertain(code: string): boolean { return ['NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR'].includes(code); }
  private focus(id: string): void { setTimeout(() => document.getElementById(id)?.focus(), 0); }
}
