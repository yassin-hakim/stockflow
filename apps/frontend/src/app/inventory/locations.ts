import { Pagination, Paging } from '../shared/pagination';
import { ReadableText } from '../shared/readable-text';
import { SectionNav } from '../shared/section-nav';
import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Location } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';

@Component({selector:'app-locations',imports: [Pagination, ReadableText, SectionNav,ReactiveFormsModule,RouterLink],templateUrl:'./locations.html'})
export class Locations {
  readonly pager = new Paging();
  private readonly api = inject(BffApi);
  readonly form = inject(FormBuilder).nonNullable.group({name:['',[Validators.required,Validators.maxLength(80)]]});
  readonly locations = signal<Location[]>([]);
  readonly loading = signal(true); readonly submitting = signal(false); readonly error = signal(''); readonly message = signal(''); readonly editing = signal<Location | null>(null);
  constructor() { void this.load(); }
  async load() {
    this.pager.reset(); this.loading.set(true); this.error.set(''); try { this.locations.set((await this.api.listLocations()).items); } catch(error) { this.error.set(describeError(error).message); } finally { this.loading.set(false); } }
  edit(location: Location) { this.editing.set(location); this.form.setValue({name:location.name}); document.getElementById('location-name')?.focus(); }
  cancel() { this.editing.set(null); this.form.reset(); }
  async submit() {
    if (this.submitting()) return;
    this.error.set(''); this.message.set('');
    const name = this.form.getRawValue().name.trim();
    if (!name || this.form.invalid) { this.error.set('Enter a location name of 1–80 characters.'); return; }
    this.submitting.set(true);
    try { const location = this.editing(); if (location) await this.api.renameLocation(location.id,name,location.version); else await this.api.createLocation(name); this.cancel(); await this.load(); this.message.set('Storage location saved.'); }
    catch(error) { this.error.set(describeError(error).message); }
    finally { this.submitting.set(false); }
  }
}
