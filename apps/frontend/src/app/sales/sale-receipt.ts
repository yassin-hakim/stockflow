import { saleLabel } from '../shared/record-labels';
import { ReadableText } from '../shared/readable-text';
import { Component, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Sale } from '@stockflow/contracts';
import { BffApi, describeError } from '../core/bff-api';
@Component({
  selector: 'app-sale-receipt',
  imports: [ReadableText, RouterLink, CurrencyPipe, DatePipe],
  templateUrl: './sale-receipt.html',
  styleUrl: './sales.css',
})
export class SaleReceipt {
  readonly label = saleLabel;
  private readonly api = inject(BffApi);
  readonly sale = signal<(Sale & { issuedAt?: string }) | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  private id = '';
  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((params) => {
        this.id = params.get('id') ?? '';
        void this.load();
      });
  }
  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.sale.set(await this.api.getSaleReceipt(this.id));
    } catch (error) {
      this.error.set(describeError(error).message);
    } finally {
      this.loading.set(false);
    }
  }
  print() {
    window.print();
  }
}
