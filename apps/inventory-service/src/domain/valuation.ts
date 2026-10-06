import { OperationError, returnLines, type Balance, type OperationCommand, type OperationPlan, type OperationResult } from './operations';

export function roundedCost(value: number, quantity: number, total: number): number {
  if (![value,quantity,total].every(Number.isSafeInteger) || value<0 || quantity<0 || total<1)
    throw new OperationError('INVALID_REQUEST','Invalid stock cost.');
  const result=Number((BigInt(value)*BigInt(quantity)+BigInt(Math.floor(total/2)))/BigInt(total));
  if(!Number.isSafeInteger(result))throw new OperationError('INVALID_REQUEST','Stock cost exceeds monetary precision.');
  return result;
}
export function assertTotalCost(plan:OperationPlan,kind:OperationCommand['kind']):void{
  const movements=kind==='TRANSFER'?plan.movements.filter(row=>row.type==='REMOVE'):plan.movements;
  if(movements.every(row=>row.costMinor!=null) && movements.reduce((sum,row)=>sum+BigInt(row.costMinor!),0n)>BigInt(Number.MAX_SAFE_INTEGER))throw new OperationError('INVALID_REQUEST','Operation cost exceeds monetary precision.');
}
export function balanceValue(balance: Balance | undefined): number | null {
  return !balance?.quantityMillis ? 0 : balance.valueMinor ?? null;
}
export function valuePlan(command:OperationCommand, previous:Balance[], plan:OperationPlan,currency='USD'):void{
  const before=(productId:string,locationId:string)=>previous.find(row=>row.productId===productId&&row.locationId===locationId);
  for(const movement of [...plan.movements].sort((a,b)=>a.type===b.type?0:a.type==='REMOVE'?-1:1)){
    const prior=before(movement.productId,movement.locationId),value=balanceValue(prior);
    if(prior?.quantityMillis && value!==null && (prior.valueCurrency??'USD')!==currency)throw new OperationError('CURRENCY_MISMATCH','Inventory costing currency cannot change while valued stock remains.');
    let cost:number|null=null;
    if(movement.type==='REMOVE') cost=value===null?null:roundedCost(value,movement.quantityMillis,prior!.quantityMillis);
    else if(command.kind==='RECEIPT'){
      const price=command.lines.find(line=>line.productId===movement.productId)?.unitCostMinor;
      cost=price===undefined?null:roundedCost(price,movement.quantityMillis,1000);
    }else if(command.kind==='TRANSFER'){
      cost=plan.movements.find(row=>row.productId===movement.productId&&row.type==='REMOVE')?.costMinor??null;
    }else if(command.kind==='COUNT') cost=value===null||!prior?.quantityMillis?null:roundedCost(value,movement.quantityMillis,prior.quantityMillis);
    movement.costMinor=cost;
    const balance=plan.balances.find(row=>row.productId===movement.productId&&row.locationId===movement.locationId)!;
    const next=value===null||cost===null?null:value+(movement.type==='ADD'?cost:-cost);
    if(next!==null&&!Number.isSafeInteger(next))throw new OperationError('INVALID_REQUEST','Stock cost exceeds monetary precision.');
    balance.valueMinor=!balance.quantityMillis?0:next;
    balance.valueCurrency=currency;
  }
  for(const balance of plan.balances)if(balance.valueMinor===undefined)balance.valueMinor=balanceValue(before(balance.productId,balance.locationId));
  assertTotalCost(plan,command.kind);
}
/** Cumulative rounding makes split returns restore exactly the original carrying cost. */
export function valueReturn(plan:OperationPlan,previous:Balance[],original:OperationResult,beforeItems:Record<string,number>,afterItems:Record<string,number>):void{
  const quantities=(items:Record<string,number>)=>Object.keys(items).length?returnLines(original.command,Object.entries(items).map(([saleLineId,quantity])=>({saleLineId,quantity}))).filter(line=>line.quantityMillis>0):[];
  const before=quantities(beforeItems),after=quantities(afterItems);
  for(const movement of [...plan.movements].sort((a,b)=>a.type===b.type?0:a.type==='REMOVE'?-1:1)){
    if(original.currency && original.currency!==(balanceCurrency(previous,movement.productId,movement.locationId)??original.currency))throw new OperationError('CURRENCY_MISMATCH','Returned ingredients must retain their original cost currency.');
    const source=original.movements.find(row=>row.productId===movement.productId&&row.type==='REMOVE');
    const oldQty=before.find(line=>line.productId===movement.productId)?.quantityMillis??0,newQty=after.find(line=>line.productId===movement.productId)?.quantityMillis??0;
    const cost=source?.costMinor==null?null:roundedCost(source.costMinor,newQty,source.quantityMillis)-roundedCost(source.costMinor,oldQty,source.quantityMillis);
    movement.costMinor=cost;
    const balance=plan.balances.find(row=>row.productId===movement.productId&&row.locationId===movement.locationId)!;
    const value=balanceValue(previous.find(row=>row.productId===movement.productId&&row.locationId===movement.locationId));
    balance.valueMinor=value===null||cost===null?null:value+cost;
    if(balance.valueMinor!==null&&!Number.isSafeInteger(balance.valueMinor))throw new OperationError('INVALID_REQUEST','Stock cost exceeds monetary precision.');
  }
  assertTotalCost(plan,'SALE_RETURN');
}

function balanceCurrency(previous:Balance[],productId:string,locationId:string){return previous.find(row=>row.productId===productId&&row.locationId===locationId)?.valueCurrency;}
