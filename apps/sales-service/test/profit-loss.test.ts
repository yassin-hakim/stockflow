import { describe, expect, it, vi } from 'vitest';
import { ProfitLoss } from '../src/application/profit-loss';
import type { InventoryPort, ReportQuery, ReportRow, SalesStore } from '../src/application/ports';
const query:ReportQuery={from:'2026-10-06T00:00:00.000Z',to:'2026-10-07T00:00:00.000Z',limit:1};
const row=(id:string,kind:ReportRow['kind'],amountMinor:number,cost:number|null|undefined,restock=false):ReportRow=>({id,saleId:'sale',kind,amountMinor,ingredientCostMinor:cost,restock,operationId:id,occurredAt:query.from,locationId:'bar',reference:'Latte receipt',currency:'USD',lines:[{name:'Latte',quantity:1,priceMinor:500}]});
function setup(records:ReportRow[]){
  const report=vi.fn(async (filters:ReportQuery)=>{
    const index=Number(filters.cursor??0),items=records.slice(index,index+filters.limit);
    const grossMinor=records.filter(row=>row.kind==='SALE').reduce((n,row)=>n+row.amountMinor,0),refundMinor=records.filter(row=>row.kind==='REFUND').reduce((n,row)=>n+row.amountMinor,0);
    return {...filters,locationId:null,currency:'USD',items,nextCursor:index+items.length<records.length?String(index+items.length):null,grossMinor,refundMinor,netMinor:grossMinor-refundMinor,completedSales:1,soldItems:2,refundedItems:1};
  });
  const status=vi.fn(async()=>({id:'operation',status:'COMMITTED' as const,costMinor:250,currency:'USD'}));
  return {service:new ProfitLoss({report} as unknown as SalesStore,{status} as unknown as InventoryPort,'USD'),report,status};
}
describe('gross profit reporting',()=>{
  it('uses full-period totals across pages and reverses only restocked ingredient costs',async()=>{
    const {service,status}=setup([row('sale','SALE',1000,300),row('no-return','REFUND',500,undefined),row('return','REFUND',500,150,true)]);
    const result=await service.report(query);
    expect(result.items).toHaveLength(1);expect(result.nextCursor).toBe('1');
    expect(result.netRevenueMinor).toBe(0);expect(result.ingredientCostMinor).toBe(150);expect(result.grossProfitMinor).toBe(-150);
    expect(status).not.toHaveBeenCalled();
    const page=await service.report({...query,cursor:'2'});
    expect(page.items[0].costMinor).toBe(-150);expect(page.items[0].grossProfitMinor).toBe(-350);expect(page.grossProfitMinor).toBe(-150);
    expect((await service.report(query,true)).items).toHaveLength(3);
  });
  it('does not imply zero cost for historical unpriced inventory',async()=>{
    const {service}=setup([row('known','SALE',500,100),row('unknown','SALE',500,null)]);
    const result=await service.report(query);
    expect(result.missingCostRecords).toBe(1);expect(result.knownCostMinor).toBe(100);expect(result.ingredientCostMinor).toBeNull();expect(result.grossProfitMinor).toBeNull();
  });
  it('resolves immutable legacy costs and fails if the source cannot be verified',async()=>{
    const {service,status}=setup([row('legacy','SALE',500,undefined)]);
    expect((await service.report(query)).grossProfitMinor).toBe(250);expect(status).toHaveBeenCalledWith('legacy');
    status.mockResolvedValueOnce(null as never);
    await expect(service.report(query)).rejects.toMatchObject({status:503});
  });
  it('keeps explicit zero costs valid and rejects unsafe snapshot costs',async()=>{
    expect((await setup([row('free','SALE',500,0)]).service.report(query)).grossProfitMinor).toBe(500);
    await expect(setup([row('invalid','SALE',500,-1)]).service.report(query)).rejects.toMatchObject({status:503});
  });
});
