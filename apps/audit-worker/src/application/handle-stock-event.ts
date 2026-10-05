import type { StockEventV1 } from '@stockflow/contracts';

export interface AuditRepository { save(event: StockEventV1): Promise<void> }
export class HandleStockEvent {
  constructor(private readonly repository: AuditRepository) {}
  execute(event: StockEventV1): Promise<void> { return this.repository.save(event); }
}
