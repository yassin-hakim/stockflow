import { describe, expect, it } from 'vitest';
import { normalizeOperation, operationFingerprint, planOperation, type Balance, type OperationCommand, type OperationResult } from '../src/domain/operations';
import { valueReturn } from '../src/domain/valuation';
import { changeStock } from '../src/domain/stock';

const productId='ingredient',locationId='z-store',destinationLocationId='a-bar',time='2026-10-06T00:00:00.000Z';
const balance=(quantityMillis:number,valueMinor?:number|null):Balance=>({productId,locationId,quantityMillis,valueMinor,version:1,createdAt:time,updatedAt:time});
const command=(kind:OperationCommand['kind'],quantityMillis:number,unitCostMinor?:number):OperationCommand=>({id:'operation',kind,locationId,destinationLocationId,reference:'Delivery',reason:'Service',lines:[{productId,quantityMillis,...(unitCostMinor===undefined?{}:{unitCostMinor})}]});
describe('recorded inventory costs',()=>{
  it('combines receipt values, consumes a moving average and keeps immutable costs',()=>{
    const first=planOperation(command('RECEIPT',2000,1000),[]);
    const second=planOperation(command('RECEIPT',2000,2000),first.balances);
    expect(second.balances[0].valueMinor).toBe(6000);
    const sold=planOperation(command('SALE',200),second.balances);
    expect(sold.movements[0].costMinor).toBe(300);
    planOperation(command('RECEIPT',1000,9999),sold.balances);
    expect(sold.movements[0].costMinor).toBe(300);
  });
  it('carries transfer value even when the destination sorts before the source',()=>{
    const moved=planOperation(command('TRANSFER',1000),[balance(4000,6000)]);
    expect(moved.movements.map(row=>row.costMinor)).toEqual([1500,1500]);
    expect(moved.balances.reduce((sum,row)=>sum+row.valueMinor!,0)).toBe(6000);
  });
  it('preserves unknown opening costs, but starts a known value after depletion',()=>{
    const mixed=planOperation(command('RECEIPT',1000,500),[balance(1000)]);
    expect(mixed.balances[0].valueMinor).toBeNull();
    const empty=planOperation(command('WASTE',2000),mixed.balances);
    expect(empty.movements[0].costMinor).toBeNull();
    expect(empty.balances[0].valueMinor).toBe(0);
    expect(planOperation(command('RECEIPT',1000,500),empty.balances).balances[0].valueMinor).toBe(500);
  });
  it('restores the original cost cumulatively across split returns',()=>{
    const originalCommand={...command('SALE',3000),allocations:[{saleLineId:'line',quantity:3,ingredients:[{productId,quantityMillis:1000}]}]};
    const sold=planOperation(originalCommand,[balance(3000,100)]);
    const original:OperationResult={...originalCommand,status:'COMMITTED',createdAt:time,command:originalCommand,movements:sold.movements};
    let previous=sold.balances;
    const costs:number[]=[];
    for(let count=1;count<=3;count++){
      const returned=planOperation(command('SALE_RETURN',1000),previous);
      valueReturn(returned,previous,original,count===1?{}:{line:count-1},{line:count});
      costs.push(returned.movements[0].costMinor!);previous=returned.balances;
    }
    expect(costs).toEqual([33,34,33]);expect(previous[0].valueMinor).toBe(100);
  });
  it('includes receipt cost in retry identity and rejects invalid or conflicting costs',()=>{
    expect(operationFingerprint(normalizeOperation(command('RECEIPT',1000,100)))).not.toBe(operationFingerprint(normalizeOperation(command('RECEIPT',1000,200))));
    for(const value of [-1,0.1,Number.MAX_SAFE_INTEGER+1])expect(()=>normalizeOperation(command('RECEIPT',1000,value))).toThrow('cost');
    expect(()=>normalizeOperation(command('TRANSFER',1000,100))).toThrow();
    const receipt=command('RECEIPT',1000,100);receipt.lines.push({productId,quantityMillis:1000,unitCostMinor:200});
    expect(()=>normalizeOperation(receipt)).toThrow('same unit cost');
  });
  it('rejects overflowing costs before changing inventory',()=>{
    const before=balance(1000,Number.MAX_SAFE_INTEGER);
    expect(()=>planOperation(command('RECEIPT',1000,1),[before])).toThrow('precision');
    expect(before.valueMinor).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('retains legacy manual-removal valuation and marks unpriced additions unknown',()=>{
    const previous={...balance(1000,1000),valueCurrency:'USD'};
    const removed=changeStock(previous,{productId,type:'REMOVE',quantityMillis:250,reason:'Adjustment',idempotencyKey:'request'});
    expect(removed.item.valueMinor).toBe(750);
    const added=changeStock(previous,{productId,type:'ADD',quantityMillis:250,reason:'Unpriced addition',idempotencyKey:'request'});
    expect(added.item.valueMinor).toBeNull();
  });
  it('rejects changing the currency of a valued balance',()=>{
    expect(()=>planOperation(command('RECEIPT',1000,100),[{...balance(1000,1000),valueCurrency:'USD'}],new Date(time),'EUR')).toThrow('currency');
    const fresh=planOperation(command('RECEIPT',1000,100),[],new Date(time),'EUR');
    expect(fresh.balances[0].valueCurrency).toBe('EUR');
  });
  it('rejects an aggregate operation-cost overflow before committing individual valid lines',()=>{
    const input=command('RECEIPT',1000,Number.MAX_SAFE_INTEGER);
    input.lines.push({productId:'second',quantityMillis:1000,unitCostMinor:1});
    expect(()=>planOperation(input,[])).toThrow('precision');
  });
});
