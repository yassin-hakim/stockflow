import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiError, InventoryOverview, Items, Product, StockChangeResult, StockMovement } from '@stockflow/contracts';

@Injectable({ providedIn: 'root' })
export class BffApi {
  private readonly http = inject(HttpClient);
  listInventory() { return firstValueFrom(this.http.get<Items<InventoryOverview>>('/api/inventory')); }
  getInventory(id: string) { return firstValueFrom(this.http.get<InventoryOverview>(`/api/inventory/${encodeURIComponent(id)}`)); }
  getMovements(id: string) { return firstValueFrom(this.http.get<Items<StockMovement>>(`/api/inventory/${encodeURIComponent(id)}/movements`)); }
  createProduct(body: { name: string; unit: string; category: string; lowStockThreshold: number }) { return firstValueFrom(this.http.post<Product>('/api/products', body)); }
  changeStock(id: string, type: 'add' | 'remove', body: { quantity: number; reason: string }, key: string) {
    return firstValueFrom(this.http.post<StockChangeResult>(`/api/inventory/${encodeURIComponent(id)}/${type}`, body, { headers: new HttpHeaders({ 'Idempotency-Key': key }) }));
  }
}

export function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as Partial<ApiError> | undefined;
    if (body?.error && typeof body.error.code === 'string' && typeof body.error.message === 'string') return body.error;
  }
  return { code: 'NETWORK_ERROR', message: 'The request could not be completed. Check the connection and try again.' };
}
