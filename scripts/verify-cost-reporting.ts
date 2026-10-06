import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {ProfitLossReport,Product,Location,MenuItem,Sale,Refund,StockOperation,StockView,Items} from '@stockflow/contracts';
const base='http://localhost:3000/api',suffix=Date.now().toString(36),from=new Date().toISOString();
async function request<T>(path:string,body?:unknown,key?:string,method=body?'POST':'GET',expected=200):Promise<T>{
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const value=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(value)}`);return value as T;
}
async function main(){
  for(const port of [3000,3001,3002,3003])assert.equal((await fetch(`http://localhost:${port}/health/ready`)).status,200);
  assert.equal((await request<{currency:string}>('/receiving-config')).currency,'USD');
  const product=await request<Product>('/products',{name:`Cost check Arabica ${suffix}`,unit:'kg',category:'Cost verification',lowStockThreshold:0},undefined,'POST',201);
  const store=await request<Location>('/locations',{name:`Cost check store ${suffix}`},undefined,'POST',201),bar=await request<Location>('/locations',{name:`Cost check counter ${suffix}`},undefined,'POST',201);
  const received=async(quantity:number,unitCostMinor:number,locationId=store.id)=>request<StockOperation>('/receipts',{locationId,reference:`Cost delivery ${quantity} at ${unitCostMinor}`,reason:'Cost reporting verification',lines:[{productId:product.id,quantity,unitCostMinor}]},randomUUID());
  const key=randomUUID(),body={locationId:store.id,reference:'First cost delivery',reason:'Cost reporting verification',lines:[{productId:product.id,quantity:2,unitCostMinor:1000}]};
  const first=await request<StockOperation>('/receipts',body,key);assert.equal(first.costMinor,2000);assert.deepEqual(await request('/receipts',body,key),first);
  await request('/receipts',{...body,lines:[{...body.lines[0],unitCostMinor:2000}]},key,'POST',409);
  await received(2,2000);
  const transfer=await request<StockOperation>('/transfers',{locationId:store.id,destinationLocationId:bar.id,reference:'Counter stock',reason:'Cost reporting verification',lines:[{productId:product.id,quantity:1}]},randomUUID());
  assert.deepEqual(transfer.movements.map(row=>row.costMinor),[1500,1500]);
  const menu=await request<MenuItem>('/menu-items',{name:`Cost check espresso ${suffix}`,category:'Cost verification',priceMinor:500,currency:'USD',ingredients:[{productId:product.id,quantity:.1}]},undefined,'POST',201);
  const draft=await request<Sale>('/sales',{locationId:bar.id,lines:[{menuItemId:menu.id,quantity:2}]},randomUUID());
  let sale=await request<Sale>(`/sales/${draft.id}/checkout`,{expectedVersion:draft.version,tender:'CASH'},randomUUID());
  for(let tries=0;sale.status==='CHECKOUT_PENDING'&&tries<40;tries++){await new Promise(resolve=>setTimeout(resolve,250));sale=await request<Sale>(`/sales/${sale.id}`);}
  assert.equal(sale.status,'COMPLETED');
  const query=()=>new URLSearchParams({from,to:new Date(Date.now()+1000).toISOString(),locationId:bar.id,limit:'1'}).toString();
  let report=await request<ProfitLossReport>(`/reports/profit-loss?${query()}`);
  assert.equal(report.grossSalesMinor,1000);assert.equal(report.ingredientCostMinor,300);assert.equal(report.grossProfitMinor,700);
  await received(1,9999,bar.id);
  report=await request<ProfitLossReport>(`/reports/profit-loss?${query()}`);assert.equal(report.grossProfitMinor,700);
  await request<Refund>(`/sales/${sale.id}/refunds`,{lines:[{saleLineId:sale.lines[0].id,quantity:1}],reason:'Refund without returned ingredients',restock:false},randomUUID());
  report=await request<ProfitLossReport>(`/reports/profit-loss?${query()}`);assert.equal(report.netRevenueMinor,500);assert.equal(report.ingredientCostMinor,300);assert.equal(report.grossProfitMinor,200);
  const returned=await request<Refund>(`/sales/${sale.id}/refunds`,{lines:[{saleLineId:sale.lines[0].id,quantity:1}],reason:'Original ingredient cost return',restock:true},randomUUID());
  assert.equal(returned.status,'COMPLETED');assert.equal((await request<StockOperation>(`/stock-operations/${returned.operationId}`)).costMinor,150);
  report=await request<ProfitLossReport>(`/reports/profit-loss?${query()}`);assert.equal(report.netRevenueMinor,0);assert.equal(report.ingredientCostMinor,150);assert.equal(report.grossProfitMinor,-150);assert.equal(report.missingCostRecords,0);assert.equal(report.items.length,1);assert.ok(report.nextCursor);
  const second=await request<ProfitLossReport>(`/reports/profit-loss?${query()}&cursor=${encodeURIComponent(report.nextCursor!)}`);assert.equal(second.grossProfitMinor,-150);assert.notEqual(second.items[0].id,report.items[0].id);
  const csv=await fetch(`${base}/reports/profit-loss/export?${query()}`);assert.equal(csv.status,200);const text=await csv.text();assert.match(text,/Gross profit/);assert.match(text,/Cost check espresso/);assert.doesNotMatch(text,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.equal((await request<StockView>(`/stock/${product.id}?locationId=${bar.id}`)).quantity,1.9);
  // Legacy unpriced receipts are deliberately represented as missing historical cost.
  const unknownBar=await request<Location>('/locations',{name:`Unpriced counter ${suffix}`},undefined,'POST',201);
  await request('/receipts',{locationId:unknownBar.id,reference:'Legacy unpriced stock',reason:'Unknown cost verification',lines:[{productId:product.id,quantity:1}]},randomUUID());
  const old=await request<Sale>('/sales',{locationId:unknownBar.id,lines:[{menuItemId:menu.id,quantity:1}]},randomUUID());
  await request(`/sales/${old.id}/checkout`,{expectedVersion:old.version,tender:'CASH'},randomUUID());
  const unknown=await request<ProfitLossReport>(`/reports/profit-loss?${new URLSearchParams({from,to:new Date(Date.now()+1000).toISOString(),locationId:unknownBar.id})}`);assert.equal(unknown.grossProfitMinor,null);assert.equal(unknown.missingCostRecords,1);
  // Ensure each catalog has enough records to exercise UI navigation.
  const menus=(await request<Items<MenuItem>>('/menu-items')).items;
  for(let i=menus.filter(row=>!row.archivedAt).length;i<12;i++)await request('/menu-items',{name:`Pagination espresso ${i+1} ${suffix}`,category:'Cost verification',priceMinor:500,currency:'USD',ingredients:[{productId:product.id,quantity:.1}]},undefined,'POST',201);
  const suppliers=(await request<Items<{id:string}>>('/suppliers')).items;
  for(let i=suppliers.length;i<12;i++)await request('/suppliers',{name:`Pagination supplier ${i+1} ${suffix}`,note:'Pagination verification'},undefined,'POST',201);
  mkdirSync('output/verification',{recursive:true});writeFileSync('output/verification/cost-reporting.json',JSON.stringify({product,store,bar,menu,sale,receipt:first,from,to:new Date(Date.now()+1000).toISOString(),report},null,2));
  console.log('PASS: priced receiving, retry identity, weighted average, transfers, historical costs, both refund choices, report pages, CSV, and unknown legacy costs.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
