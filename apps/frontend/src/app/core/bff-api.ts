import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ApiError,
  InventoryOverview,
  Items,
  Product,
  StockChangeResult,
  StockMovement,
  Location, StockView, Page, StockOperation, StockMovementV2, StockCount, Supplier,
  ReplenishmentRule, ReplenishmentItem, MenuItem, Sale, SaleCartLine, Refund, RefundLine, InventoryReport, SalesReport, ProfitLossReport,
} from '@stockflow/contracts';

@Injectable({ providedIn: 'root' })
export class BffApi {
  private readonly http = inject(HttpClient);
  receivingConfig(){return firstValueFrom(this.http.get<{currency:string}>('/api/receiving-config'));}
  listLocations() { return firstValueFrom(this.http.get<Items<Location>>('/api/locations')); }
  createLocation(name: string) { return firstValueFrom(this.http.post<Location>('/api/locations',{name})); }
  renameLocation(id: string,name: string,expectedVersion: number) { return firstValueFrom(this.http.patch<Location>(`/api/locations/${encodeURIComponent(id)}`,{name,expectedVersion})); }
  listStock(locationId?: string) { return firstValueFrom(this.http.get<Items<StockView>>('/api/stock',{params:locationId ? {locationId} : {}})); }
  listOperations(kind?: string,cursor?: string,filters:Record<string,string>={}) { return firstValueFrom(this.http.get<Page<StockOperation>>('/api/operations',{params:{...filters,...(kind ? {kind} : {}),...(cursor ? {cursor} : {})}})); }
  getOperation(id: string) { return firstValueFrom(this.http.get<StockOperation>(`/api/stock-operations/${encodeURIComponent(id)}`)); }
  executeOperation(kind: 'receipts' | 'transfers' | 'waste',body: object,key: string) {
    return firstValueFrom(this.http.post<StockOperation>(`/api/${kind}`,body,{headers:new HttpHeaders({'Idempotency-Key':key})}));
  }
  listInventory() {
    return firstValueFrom(this.http.get<Items<InventoryOverview>>('/api/inventory'));
  }
  getInventory(id: string) {
    return firstValueFrom(
      this.http.get<InventoryOverview>(`/api/inventory/${encodeURIComponent(id)}`),
    );
  }
  getMovements(id: string) {
    return firstValueFrom(
      this.http.get<Items<StockMovement>>(`/api/inventory/${encodeURIComponent(id)}/movements`),
    );
  }
  listProducts() { return firstValueFrom(this.http.get<Items<Product>>('/api/products')); }
  listSuppliers() { return firstValueFrom(this.http.get<Items<Supplier>>('/api/suppliers')); }
  createSupplier(body: {name:string;note:string}) { return firstValueFrom(this.http.post<Supplier>('/api/suppliers',body)); }
  editSupplier(id: string,body: {name:string;note:string;expectedVersion:number}) { return firstValueFrom(this.http.patch<Supplier>(`/api/suppliers/${encodeURIComponent(id)}`,body)); }
  getStockMovements(id:string,params:Record<string,string>={}) { return firstValueFrom(this.http.get<Page<StockMovementV2>>(`/api/stock/${encodeURIComponent(id)}/movements`,{params})); }
  getStock(id:string,locationId?:string) { return firstValueFrom(this.http.get<StockView>(`/api/stock/${encodeURIComponent(id)}`,{params:locationId?{locationId}:{}})); }
  listCounts(cursor?:string) { return firstValueFrom(this.http.get<Page<StockCount>>('/api/counts',{params:cursor?{cursor}:{}})); }
  getCount(id:string) { return firstValueFrom(this.http.get<StockCount>(`/api/counts/${encodeURIComponent(id)}`)); }
  createCount(body:{locationId:string;productIds:string[];reason:string},key:string) { return firstValueFrom(this.http.post<StockCount>('/api/counts',body,{headers:new HttpHeaders({'Idempotency-Key':key})})); }
  editCount(id:string,body:{expectedVersion:number;lines:{productId:string;countedQuantity:number|null}[];reason?:string}) { return firstValueFrom(this.http.patch<StockCount>(`/api/counts/${encodeURIComponent(id)}`,body)); }
  applyCount(id:string,expectedVersion:number,key:string) { return firstValueFrom(this.http.post<StockOperation>(`/api/counts/${encodeURIComponent(id)}/apply`,{expectedVersion},{headers:new HttpHeaders({'Idempotency-Key':key})})); }
  cancelCount(id:string,expectedVersion:number) { return firstValueFrom(this.http.post<StockCount>(`/api/counts/${encodeURIComponent(id)}/cancel`,{expectedVersion})); }
  listReplenishment(locationId:string) { return firstValueFrom(this.http.get<Items<ReplenishmentItem>>('/api/replenishment',{params:{locationId}})); }
  saveReplenishment(body:{productId:string;locationId:string;lowStockThreshold:number;targetQuantity:number;expectedVersion:number|null}) { return firstValueFrom(this.http.post<ReplenishmentRule>('/api/replenishment-rules',body)); }
  listMenuItems() { return firstValueFrom(this.http.get<Items<MenuItem> & {currency:string}>('/api/menu-items')); }
  getMenuItem(id:string) { return firstValueFrom(this.http.get<MenuItem>(`/api/menu-items/${encodeURIComponent(id)}`)); }
  getMenuRevision(id:string,revision:number) { return firstValueFrom(this.http.get<MenuItem>(`/api/menu-items/${encodeURIComponent(id)}/revisions/${revision}`)); }
  createMenuItem(body:{name:string;category:string;priceMinor:number;currency?:string;ingredients:{productId:string;quantity:number}[]}) { return firstValueFrom(this.http.post<MenuItem>('/api/menu-items',body)); }
  publishMenuItem(id:string,body:{name:string;category:string;priceMinor:number;currency?:string;ingredients:{productId:string;quantity:number}[];expectedVersion:number}) { return firstValueFrom(this.http.post<MenuItem>(`/api/menu-items/${encodeURIComponent(id)}/publish`,body)); }
  archiveMenuItem(id:string,expectedVersion:number) { return firstValueFrom(this.http.post<MenuItem>(`/api/menu-items/${encodeURIComponent(id)}/archive`,{expectedVersion})); }
  createSale(body:{locationId:string;lines:SaleCartLine[]},key:string){return firstValueFrom(this.http.post<Sale>('/api/sales',body,{headers:new HttpHeaders({'Idempotency-Key':key})}));}
  editSale(id:string,body:{expectedVersion:number;locationId:string;lines:SaleCartLine[]}){return firstValueFrom(this.http.patch<Sale>(`/api/sales/${encodeURIComponent(id)}`,body));}
  getSale(id:string){return firstValueFrom(this.http.get<Sale>(`/api/sales/${encodeURIComponent(id)}`));}
  listSales(params:Record<string,string>={}){return firstValueFrom(this.http.get<Page<Sale>>('/api/sales',{params}));}
  checkoutSale(id:string,body:{expectedVersion:number;tender:'CASH'|'CARD'},key:string){return firstValueFrom(this.http.post<Sale>(`/api/sales/${encodeURIComponent(id)}/checkout`,body,{headers:new HttpHeaders({'Idempotency-Key':key})}));}
  cancelSale(id:string,expectedVersion:number){return firstValueFrom(this.http.post<Sale>(`/api/sales/${encodeURIComponent(id)}/cancel`,{expectedVersion}));}
  getReceipt(id:string){return firstValueFrom(this.http.get<Sale & {issuedAt:string}>(`/api/sales/${encodeURIComponent(id)}/receipt`));}
  getSaleReceipt(id:string){return this.getReceipt(id);}
  listRefunds(id:string){return firstValueFrom(this.http.get<Items<Refund>>(`/api/sales/${encodeURIComponent(id)}/refunds`));}
  getRefund(id:string,refundId:string){return firstValueFrom(this.http.get<Refund>(`/api/sales/${encodeURIComponent(id)}/refunds/${encodeURIComponent(refundId)}`));}
  createRefund(id:string,body:{lines:RefundLine[];reason:string;restock:boolean;expectedVersion?:number},key:string){return firstValueFrom(this.http.post<Refund>(`/api/sales/${encodeURIComponent(id)}/refunds`,body,{headers:new HttpHeaders({'Idempotency-Key':key})}));}
  refundSale(id:string,body:{lines:RefundLine[];reason:string;restock:boolean;expectedVersion?:number},key:string){return this.createRefund(id,body,key);}
  getInventoryReport(params:Record<string,string>){return firstValueFrom(this.http.get<InventoryReport>('/api/reports/inventory',{params}));}
  getSalesReport(params:Record<string,string>){return firstValueFrom(this.http.get<SalesReport>('/api/reports/sales',{params}));}
  getProfitLossReport(params:Record<string,string>){return firstValueFrom(this.http.get<ProfitLossReport>('/api/reports/profit-loss',{params}));}
  exportReport(kind:'inventory'|'sales'|'profit-loss',params:Record<string,string>){return firstValueFrom(this.http.get(`/api/reports/${kind}/export`,{params,responseType:'blob'}));}
  getProduct(id: string) { return firstValueFrom(this.http.get<Product>(`/api/products/${encodeURIComponent(id)}`)); }
  editProduct(id: string, body: { name: string; category: string; lowStockThreshold: number; sku: string | null; expectedVersion: number }) {
    return firstValueFrom(this.http.patch<Product>(`/api/products/${encodeURIComponent(id)}`, body));
  }
  archiveProduct(id: string, expectedVersion: number) {
    return firstValueFrom(this.http.post<Product>(`/api/products/${encodeURIComponent(id)}/archive`, { expectedVersion }));
  }
  createProduct(body: { name: string; unit: string; category: string; lowStockThreshold: number; sku?: string | null }) {
    return firstValueFrom(this.http.post<Product>('/api/products', body));
  }
  changeStock(
    id: string,
    type: 'add' | 'remove',
    body: { quantity: number; reason: string },
    key: string,
  ) {
    return firstValueFrom(
      this.http.post<StockChangeResult>(`/api/inventory/${encodeURIComponent(id)}/${type}`, body, {
        headers: new HttpHeaders({ 'Idempotency-Key': key }),
      }),
    );
  }
  changeLocationStock(id:string,type:'add'|'remove',body:{locationId:string;quantity:number;reason:string},key:string){return firstValueFrom(this.http.post<StockOperation>(`/api/stock/${encodeURIComponent(id)}/${type}`,body,{headers:new HttpHeaders({'Idempotency-Key':key})}));}
}

export function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as Partial<ApiError> | undefined;
    if (
      body?.error &&
      typeof body.error.code === 'string' &&
      typeof body.error.message === 'string'
    )
      return body.error;
  }
  return {
    code: 'NETWORK_ERROR',
    message: 'The request could not be completed. Check the connection and try again.',
  };
}
