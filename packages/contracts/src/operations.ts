import type { Product, StockMovement, StockStatus, StockEventV1 } from './index';

export interface Page<T> { items: T[]; nextCursor: string | null }
export interface Location { id: string; name: string; version: number; createdAt: string; updatedAt: string }
export type MovementCause = 'MANUAL' | 'RECEIPT' | 'TRANSFER' | 'WASTE' | 'COUNT' | 'SALE' | 'SALE_RETURN';
export interface StockMovementV2 extends StockMovement { costMinor?:number|null; locationId: string; operationId: string; cause: MovementCause; resultingQuantity: number; sourceReference?: string }
export interface StockEventV2 extends Omit<StockEventV1, 'schemaVersion'> { schemaVersion: 2; locationId: string; operationId: string; cause: MovementCause }
export type StockEvent = StockEventV1 | StockEventV2;
export interface LocationBalance { productId: string; locationId: string; quantity: number; version: number }
export interface StockView { product: Product; locationId: string | null; quantity: number; status: StockStatus; lowStockThreshold: number; targetQuantity: number | null; locations?: { locationId: string; name: string; quantity: number; status: StockStatus; lowStockThreshold: number; targetQuantity: number | null }[] }
export interface StockLine { unitCostMinor?:number; productId: string; quantity: number }
export interface StockOperation {
  costMinor?:number|null; currency?:string; receivedLines?:{productId:string;quantity:number;unitCostMinor:number|null}[]; id: string; kind: MovementCause; status: 'COMMITTED' | 'REJECTED'; createdAt: string; reference: string; reason: string; locationId: string; destinationLocationId?: string; movements: StockMovementV2[]; error?: { code: string; message: string } }
export interface Supplier { id: string; name: string; note: string; version: number; createdAt: string; updatedAt: string }
export interface CountLine { productId: string; recordedQuantity: number; expectedVersion: number | null; countedQuantity: number | null; differenceQuantity: number | null }
export interface StockCount { id: string; locationId: string; status: 'DRAFT' | 'APPLIED' | 'CANCELLED'; lines: CountLine[]; reason: string; version: number; createdAt: string; updatedAt: string; operationId?: string }
export interface ReplenishmentRule { productId: string; locationId: string; lowStockThreshold: number; targetQuantity: number; version: number }
export interface ReplenishmentItem extends StockView { suggestedQuantity: number | null; version: number | null }
export interface RecipeIngredient { productId: string; name: string; unit: string; quantity: number }
export interface MenuItem { id: string; name: string; category: string; priceMinor: number; currency: string; version: number; recipeRevision: number; ingredients: RecipeIngredient[]; archivedAt: string | null; createdAt: string; updatedAt: string }
export interface SaleCartLine { menuItemId: string; quantity: number }
export interface SaleLine { id: string; menuItemId: string; name: string; quantity: number; priceMinor: number; totalMinor: number; recipeRevision: number; ingredients: RecipeIngredient[] }
export type SaleState = 'DRAFT' | 'CHECKOUT_PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
export interface Sale { id: string; status: SaleState; locationId: string; lines: SaleLine[]; totalMinor: number; currency: string; version: number; tender: 'CASH' | 'CARD' | null; receiptReference: string | null; createdAt: string; updatedAt: string; operationId?: string; error?: { code: string; message: string }; refunds?: Refund[] }
export interface RefundLine { saleLineId: string; quantity: number }
export interface Refund { id: string; saleId: string; status: 'REFUND_PENDING' | 'COMPLETED' | 'REJECTED'; lines: RefundLine[]; amountMinor: number; currency: string; reason: string; restock: boolean; operationId?: string; createdAt: string; updatedAt: string; error?: { code: string; message: string } }
export interface SalesEvent { schemaVersion: 1; eventId: string; eventType: 'SaleCompleted' | 'SaleRefunded'; saleId: string; referenceId: string; locationId: string; amountMinor: number; currency: string; occurredAt: string; receiptReference?:string }
export interface InventoryReport extends Page<StockMovementV2> {filters:{locationId?:string;productId?:string;cause?:string;from?:string;to?:string};products:{productId:string;name:string;unit:string;addedQuantity:number;removedQuantity:number;consumedQuantity:number;wasteQuantity:number;transferInQuantity:number;transferOutQuantity:number;countVariance:number}[]}
export interface SalesReport extends Page<{id:string;saleId:string;kind:'SALE'|'REFUND';occurredAt:string;locationId:string;reference:string;amountMinor:number;currency:string;lines:{name:string;quantity:number;priceMinor:number}[]}> {from:string;to:string;locationId:string|null;currency:string;grossMinor:number;refundMinor:number;netMinor:number;completedSales:number;refundedItems:number;soldItems:number}

export interface ProfitLossRow {id:string;saleId:string;kind:'SALE'|'REFUND';occurredAt:string;locationId:string;reference:string;currency:string;lines:{name:string;quantity:number;priceMinor:number}[];revenueMinor:number;costMinor:number|null;grossProfitMinor:number|null}
export interface ProfitLossReport extends Page<ProfitLossRow> {from:string;to:string;locationId:string|null;currency:string;grossSalesMinor:number;refundMinor:number;netRevenueMinor:number;ingredientCostMinor:number|null;knownCostMinor:number;missingCostRecords:number;grossProfitMinor:number|null}
