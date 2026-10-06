import { Injectable, InjectionToken, inject } from '@angular/core';
import { isUuid, quantityMillis } from '@stockflow/primitives';

export const STOCK_REQUEST_STORAGE = new InjectionToken<Storage | null>('Stock request storage', {
  providedIn: 'root',
  factory: () => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  },
});

export interface PendingStockCommand {
  productId: string;
  type: 'add' | 'remove';
  quantity: number;
  reason: string;
  key: string;
  locationId?: string;
}

@Injectable({ providedIn: 'root' })
export class PendingStockCommands {
  private readonly storage = inject(STOCK_REQUEST_STORAGE);
  private storageKey(id: string): string {
    return `stockflow:pending-stock:v1:${id}`;
  }

  get(id: string): PendingStockCommand | null {
    if (!this.storage) throw new Error('Stock request storage is unavailable.');
    const raw = this.storage.getItem(this.storageKey(id));
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<PendingStockCommand> | null;
    if (
      !value ||
      value.productId !== id ||
      !isUuid(value.productId) ||
      !isUuid(value.key) ||
      (value.locationId !== undefined && !isUuid(value.locationId)) ||
      !['add', 'remove'].includes(value.type ?? '') ||
      quantityMillis(value.quantity) === null ||
      typeof value.reason !== 'string' ||
      value.reason !== value.reason.trim() ||
      !value.reason ||
      value.reason.length > 200
    ) {
      throw new Error('The saved stock request could not be recovered.');
    }
    return value as PendingStockCommand;
  }

  save(command: PendingStockCommand): void {
    // Persist before sending: a refresh during the POST must retain its identity.
    const previous = this.get(command.productId);
    if (previous && (previous.key !== command.key || previous.locationId !== command.locationId || previous.quantity !== command.quantity || previous.reason !== command.reason || previous.type !== command.type))
      throw new Error('Resolve the earlier stock request first.');
    this.storage!.setItem(this.storageKey(command.productId), JSON.stringify(command));
  }

  clear(id: string, key: string): void {
    if (this.get(id)?.key === key) this.storage!.removeItem(this.storageKey(id));
  }
}
