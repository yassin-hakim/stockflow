import type { ProfitLossReport } from '@stockflow/contracts';
import { SalesError } from '../domain/sale';
import type { InventoryPort, ReportQuery, ReportRow, SalesStore } from './ports';

export class ProfitLoss {
  constructor(private readonly store:SalesStore,private readonly inventory:InventoryPort,private readonly currency:string){}
  async report(query:ReportQuery,all=false):Promise<ProfitLossReport>{
    const page=await this.store.report(query,this.currency);
    const records:ReportRow[]=[];let cursor:string|undefined;
    if(this.store.reportRecords)records.push(...await this.store.reportRecords(query));
    else do{
      const batch=await this.store.report({...query,cursor,limit:100},this.currency);
      records.push(...batch.items);cursor=batch.nextCursor??undefined;
      if(records.length>10000)throw new SalesError('INVALID_REQUEST','P&L exceeds 10,000 records; narrow the period.',422);
    }while(cursor);
    if(records.length>10000)throw new SalesError('INVALID_REQUEST','P&L exceeds 10,000 records; narrow the period.',422);
    const costs=new Map<string,number|null>();
    for(let index=0;index<records.length;index+=10){
      await Promise.all(records.slice(index,index+10).map(async row=>{
        let cost:number|null=0;
        if((row.kind==='SALE'||row.restock) && row.ingredientCostMinor!==undefined) cost=row.ingredientCostMinor;
        else if(row.kind==='SALE'||row.restock){
          const operation=row.operationId?await this.inventory.status(row.operationId):null;
          if(!operation||operation.status!=='COMMITTED')throw new SalesError('SERVICE_UNAVAILABLE','A recorded ingredient cost could not be verified.',503);
          if(operation.currency && operation.currency!==this.currency)throw new SalesError('CURRENCY_MISMATCH','Inventory and sales currencies must match.');
          cost=operation.costMinor??null;
          if(cost!==null&&(!Number.isSafeInteger(cost)||cost<0))throw new SalesError('SERVICE_UNAVAILABLE','A recorded ingredient cost is invalid.',503);
        }
        if(cost!==null&&(!Number.isSafeInteger(cost)||cost<0))throw new SalesError('SERVICE_UNAVAILABLE','A recorded ingredient cost is invalid.',503);
        costs.set(`${row.kind}:${row.id}`,cost===null?null:row.kind==='REFUND'?-cost:cost);
      }));
    }
    let totalCost=0n,missingCostRecords=0;
    for(const value of costs.values())if(value===null)missingCostRecords++;else totalCost+=BigInt(value);
    const knownCostMinor=Number(totalCost);
    if(!Number.isSafeInteger(knownCostMinor)||!Number.isSafeInteger(page.netMinor-knownCostMinor))throw new SalesError('INVALID_REQUEST','P&L exceeds monetary precision.',422);
    return {from:query.from,to:query.to,locationId:query.locationId??null,currency:this.currency,
      grossSalesMinor:page.grossMinor,refundMinor:page.refundMinor,netRevenueMinor:page.netMinor,
      ingredientCostMinor:missingCostRecords?null:knownCostMinor,knownCostMinor,missingCostRecords,
      grossProfitMinor:missingCostRecords?null:page.netMinor-knownCostMinor,nextCursor:all?null:page.nextCursor,
      items:(all?records:page.items).map(row=>{const costMinor=costs.get(`${row.kind}:${row.id}`)??null,revenueMinor=row.kind==='REFUND'?-row.amountMinor:row.amountMinor;return {...row,revenueMinor,costMinor,grossProfitMinor:costMinor===null?null:revenueMinor-costMinor};})};
  }
}
