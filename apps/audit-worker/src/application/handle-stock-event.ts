import type { StockEvent } from "@stockflow/contracts";

export interface AuditRepository {
  save(event: StockEvent): Promise<void>;
}
export class HandleStockEvent {
  constructor(private readonly repository: AuditRepository) {}
  execute(event: StockEvent): Promise<void> {
    return this.repository.save(event);
  }
}
