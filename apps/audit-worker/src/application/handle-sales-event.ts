import type { SalesEvent } from '@stockflow/contracts';
export interface SalesAuditRepository {save(event:SalesEvent):Promise<void>}
export class HandleSalesEvent {
  constructor(private readonly repository:SalesAuditRepository){}
  execute(event:SalesEvent):Promise<void>{return this.repository.save(event);}
}
