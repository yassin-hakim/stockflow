import { Injectable, inject } from '@angular/core';
import { isUuid, quantityMillis } from '@stockflow/primitives';
import { STOCK_REQUEST_STORAGE } from './pending-stock-commands';

export interface PendingOperation {
  kind: 'receipts' | 'transfers' | 'waste';
  key: string;
  body: Record<string, unknown>;
}
@Injectable({ providedIn: 'root' })
export class PendingOperations {
  private readonly storage = inject(STOCK_REQUEST_STORAGE);
  private readonly name = 'stockflow:pending-operation:v2';
  get(): PendingOperation | null {
    if (!this.storage) throw new Error('Browser storage is unavailable.');
    const raw = this.storage.getItem(this.name);
    if (raw === null) return null;
    const value = JSON.parse(raw) as PendingOperation;
    if (
      !value ||
      !['receipts', 'transfers', 'waste'].includes(value.kind) ||
      !isUuid(value.key) ||
      !value.body ||
      typeof value.body !== 'object' ||
      Array.isArray(value.body)
    )
      throw new Error('The saved operation could not be recovered.');
    const body = value.body;
    if (
      !isUuid(body['locationId']) ||
      typeof body['reason'] !== 'string' ||
      !body['reason'].trim() ||
      body['reason'].length > 200 ||
      typeof body['reference'] !== 'string' ||
      !body['reference'].trim() ||
      body['reference'].length > 100 ||
      !Array.isArray(body['lines']) ||
      !body['lines'].length ||
      body['lines'].length > 100 ||
      body['lines'].some(
        (line) => !line || !isUuid(line.productId) || quantityMillis(line.quantity) === null || (line.unitCostMinor!==undefined && (value.kind!=='receipts' || !Number.isSafeInteger(line.unitCostMinor) || line.unitCostMinor<0)),
      ) ||
      (value.kind === 'transfers' &&
        (!isUuid(body['destinationLocationId']) ||
          body['destinationLocationId'] === body['locationId']))
    )
      throw new Error('The saved operation input could not be recovered.');
    return value;
  }
  save(value: PendingOperation): void {
    const previous = this.get();
    if (
      previous &&
      (previous.key !== value.key ||
        previous.kind !== value.kind ||
        JSON.stringify(previous.body) !== JSON.stringify(value.body))
    )
      throw new Error('Resolve the saved operation before changing its input.');
    this.storage!.setItem(this.name, JSON.stringify(value));
  }
  clear(key: string): void {
    if (this.get()?.key === key) this.storage!.removeItem(this.name);
  }
}
