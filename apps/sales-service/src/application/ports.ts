import type { CatalogItem, RefundRecord, SaleRecord } from "../domain/sale";
import type { SalesEvent } from "@stockflow/contracts";
export interface ConsumeCommand {
  operationId: string;
  locationId: string;
  reference: string;
  reason: string;
  lines: { productId: string; quantity: number }[];
  allocations: {
    saleLineId: string;
    quantity: number;
    ingredients: { productId: string; quantity: number }[];
  }[];
}
export interface ReturnCommand {
  operationId: string;
  originalOperationId: string;
  returnedItems: { saleLineId: string; quantity: number }[];
  reason: string;
}
export interface OperationOutcome {
  costMinor?: number | null;
  currency?: string;
  id: string;
  status: "COMMITTED" | "REJECTED";
  error?: { code: string; message: string };
}
export interface CatalogPort {
  menu(id: string, requestId?: string): Promise<CatalogItem>;
  activeProduct(id: string, requestId?: string): Promise<void>;
}
export interface InventoryPort {
  status(id: string, requestId?: string): Promise<OperationOutcome | null>;
  consume(body: ConsumeCommand, requestId?: string): Promise<OperationOutcome>;
  returnStock(
    body: ReturnCommand,
    requestId?: string,
  ): Promise<OperationOutcome>;
}
export interface CommandRecord {
  id: string;
  kind: string;
  fingerprint: string;
  saleId: string;
  referenceId?: string;
}
export interface Attempt {
  id: string;
  saleId: string;
  status: "CHECKOUT_PENDING" | "COMPLETED" | "REJECTED";
  command: ConsumeCommand;
  /** Frozen prepared cart and terminal reply, retained independently of later draft edits. */
  snapshot?: SaleRecord;
  result?: SaleRecord;
  createdAt: string;
  updatedAt: string;
}
export interface StoredRefund extends RefundRecord {
  command?: ReturnCommand;
}
export interface Receipt {
  saleId: string;
  reference: string;
  sale: SaleRecord;
  issuedAt: string;
}
export interface OutboxEvent {
  eventId: string;
  subject: string;
  payload: SalesEvent;
  createdAt: string;
  publishedAt: string | null;
  attempts: number;
  nextAttemptAt: string;
}
export interface SalesTransaction {
  sale(id: string): Promise<SaleRecord | null>;
  saveSale(sale: SaleRecord): Promise<void>;
  command(id: string): Promise<CommandRecord | null>;
  saveCommand(command: CommandRecord): Promise<void>;
  attempt(id: string): Promise<Attempt | null>;
  saveAttempt(attempt: Attempt): Promise<void>;
  refund(id: string): Promise<StoredRefund | null>;
  refunds(saleId: string): Promise<StoredRefund[]>;
  saveRefund(refund: StoredRefund): Promise<void>;
  saveReceipt(receipt: Receipt): Promise<void>;
  saveEvent(event: OutboxEvent): Promise<void>;
}
export interface ReportQuery {
  from: string;
  to: string;
  locationId?: string;
  limit: number;
  cursor?: string;
}
export interface ReportRow {
  ingredientCostMinor?:number|null;
  operationId?:string;
  restock?:boolean;
  id: string;
  saleId: string;
  kind: "SALE" | "REFUND";
  occurredAt: string;
  locationId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  lines: { name: string; quantity: number; priceMinor: number }[];
}
export interface SalesReport {
  items: ReportRow[];
  nextCursor: string | null;
  from: string;
  to: string;
  locationId: string | null;
  currency: string;
  grossMinor: number;
  refundMinor: number;
  netMinor: number;
  completedSales: number;
  refundedItems: number;
  soldItems: number;
}
export interface SalesStore {
  transaction<T>(work: (tx: SalesTransaction) => Promise<T>): Promise<T>;
  sale(id: string): Promise<SaleRecord | null>;
  refund(id: string): Promise<StoredRefund | null>;
  refunds(saleId: string): Promise<StoredRefund[]>;
  attempt(id: string): Promise<Attempt | null>;
  command(id: string): Promise<CommandRecord | null>;
  receipt(saleId: string): Promise<Receipt | null>;
  list(query: {
    limit: number;
    cursor?: string;
    status?: string;
    locationId?: string;
    search?: string;
  }): Promise<{ items: SaleRecord[]; nextCursor: string | null }>;
  pending(
    limit: number,
  ): Promise<{ attempts: Attempt[]; refunds: StoredRefund[] }>;
  report(query: ReportQuery, currency: string): Promise<SalesReport>;
  reportRecords?(query:ReportQuery):Promise<ReportRow[]>;
  events(limit: number): Promise<OutboxEvent[]>;
  published(id: string, at: string): Promise<void>;
  failed(id: string, attempts: number, next: string): Promise<void>;
}
export interface EventPublisher {
  publish(event: OutboxEvent): Promise<void>;
}
