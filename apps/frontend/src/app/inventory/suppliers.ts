import { Pagination, Paging } from '../shared/pagination';
import { ReadableText } from '../shared/readable-text';
import { SectionNav } from '../shared/section-nav';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Supplier } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
@Component({
  selector: 'app-suppliers',
  imports: [Pagination, ReadableText, SectionNav, ReactiveFormsModule, RouterLink],
  templateUrl: './suppliers.html',
})
export class Suppliers {
  readonly pager = new Paging();
  private readonly api = inject(BffApi);
  readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    note: ['', Validators.maxLength(200)],
  });
  readonly suppliers = signal<Supplier[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly editing = signal<Supplier | null>(null);
  constructor() {
    void this.load();
  }
  async load() {
    this.pager.reset();
    this.loading.set(true);
    this.error.set('');
    try {
      this.suppliers.set((await this.api.listSuppliers()).items);
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.loading.set(false);
    }
  }
  edit(value: Supplier) {
    if (this.busy()) return;
    this.editing.set(value);
    this.form.setValue({ name: value.name, note: value.note });
    this.message.set('');
    document.getElementById('supplier-name')?.focus();
  }
  cancel() {
    if (this.busy()) return;
    this.editing.set(null);
    this.form.reset();
  }
  async save() {
    if (this.busy()) return;
    this.error.set('');
    this.message.set('');
    const value = this.form.getRawValue();
    if (this.form.invalid || !value.name.trim()) {
      this.error.set(
        'Enter a supplier name of 1–80 characters and a contact note of at most 200 characters.',
      );
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      const existing = this.editing(),
        body = { name: value.name.trim(), note: value.note.trim() };
      if (existing)
        await this.api.editSupplier(existing.id, { ...body, expectedVersion: existing.version });
      else await this.api.createSupplier(body);
      this.editing.set(null);
      this.form.reset();
      await this.load();
      this.message.set('Supplier reference saved.');
    } catch (error) {
      this.error.set(describeError(error).message);
      queueMicrotask(() => document.getElementById('supplier-error')?.focus());
    } finally {
      this.busy.set(false);
    }
  }
}
