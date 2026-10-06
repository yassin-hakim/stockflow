import { Injectable, inject } from '@angular/core';
import { isUuid } from '@stockflow/primitives';
import { STOCK_REQUEST_STORAGE } from '../core/pending-stock-commands';
export interface PendingSaleCommand {
  kind: 'CREATE' | 'CHECKOUT' | 'REFUND';
  key: string;
  saleId?: string;
  body: Record<string, unknown>;
}
@Injectable({ providedIn: 'root' })
export class PendingSales {
  private readonly storage = inject(STOCK_REQUEST_STORAGE);
  private readonly name = 'stockflow:pending-sales:v1';
  private readonly draftName = 'stockflow:pos-draft:v1';
  private validate(value: PendingSaleCommand) {
    const invalid = () => {
      throw new Error('Saved sale command cannot be recovered.');
    };
    if (
      !value ||
      !['CREATE', 'CHECKOUT', 'REFUND'].includes(value.kind) ||
      !isUuid(value.key) ||
      !value.body ||
      typeof value.body !== 'object' ||
      Array.isArray(value.body) ||
      (value.kind !== 'CREATE' && !isUuid(value.saleId))
    )
      invalid();
    const body = value.body;
    if (value.kind === 'CHECKOUT') {
      if (
        !Number.isSafeInteger(body['expectedVersion']) ||
        Number(body['expectedVersion']) < 0 ||
        !['CASH', 'CARD'].includes(String(body['tender'])) ||
        (body['locationId'] !== undefined && !isUuid(body['locationId']))
      )
        invalid();
    } else {
      const lines = body['lines'];
      if (!Array.isArray(lines) || !lines.length || lines.length > 100) invalid();
      for (const line of lines as Record<string, unknown>[]) {
        if (
          !line ||
          typeof line !== 'object' ||
          !isUuid(line[value.kind === 'CREATE' ? 'menuItemId' : 'saleLineId']) ||
          !Number.isSafeInteger(line['quantity']) ||
          Number(line['quantity']) < 1
        )
          invalid();
      }
      if (value.kind === 'CREATE') {
        if (!isUuid(body['locationId'])) invalid();
      } else if (
        typeof body['restock'] !== 'boolean' ||
        typeof body['reason'] !== 'string' ||
        !body['reason'].trim() ||
        body['reason'].length > 500
      )
        invalid();
    }
  }
  get(): PendingSaleCommand | null {
    if (!this.storage) throw new Error('Browser storage is unavailable.');
    const raw = this.storage.getItem(this.name);
    if (raw === null) return null;
    const value = JSON.parse(raw) as PendingSaleCommand;
    this.validate(value);
    return value;
  }
  save(value: PendingSaleCommand) {
    this.validate(value);
    const previous = this.get();
    if (previous && JSON.stringify(previous) !== JSON.stringify(value))
      throw new Error('Resolve the saved sale command before changing its input.');
    this.storage!.setItem(this.name, JSON.stringify(value));
  }
  clear(key: string) {
    if (this.get()?.key === key) this.storage!.removeItem(this.name);
  }
  draft(): string | null {
    if (!this.storage) throw new Error('Browser storage is unavailable.');
    const value = this.storage.getItem(this.draftName);
    if (value && !isUuid(value)) throw new Error('Saved draft cannot be recovered.');
    return value;
  }
  saveDraft(id: string | null) {
    if (!this.storage) throw new Error('Browser storage is unavailable.');
    if (id) this.storage.setItem(this.draftName, id);
    else this.storage.removeItem(this.draftName);
  }
}
