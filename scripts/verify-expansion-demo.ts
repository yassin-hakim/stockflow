import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import type { Product, Location, MenuItem, Sale, Refund, StockCount, StockOperation, StockView, Items, ReplenishmentItem, InventoryReport, SalesReport } from '@stockflow/contracts';

const base=process.env.BFF_URL??'http://localhost:3000/api';
const suffix=randomUUID().slice(0,8),from=new Date().toISOString();
async function request<T>(path:string,body?:unknown,key?:string,method=body?'POST':'GET',expected=200):Promise<T>{
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const value=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(value)}`);return value as T;
}
async function stock(productId:string,locationId:string){return (await request<StockView>(`/stock/${productId}?locationId=${locationId}`)).quantity;}
async function terminal(id:string){let sale=await request<Sale>(`/sales/${id}`);for(let tries=0;sale.status==='CHECKOUT_PENDING'&&tries<40;tries++){await new Promise(resolve=>setTimeout(resolve,250));sale=await request<Sale>(`/sales/${id}`);}return sale;}
async function main(){
  const coffee=await request<Product>('/products',{name:`Arabica Coffee ${suffix}`,category:'Coffee',unit:'kg',sku:`COFFEE-${suffix}`,lowStockThreshold:5},undefined,'POST',201);
  const milk=await request<Product>('/products',{name:`Milk ${suffix}`,category:'Dairy',unit:'L',sku:`MILK-${suffix}`,lowStockThreshold:1.5},undefined,'POST',201);
  const main=await request<Location>('/locations',{name:`Main Store ${suffix}`},undefined,'POST',201),bar=await request<Location>('/locations',{name:`Bar ${suffix}`},undefined,'POST',201);
  const supplier=await request<{id:string}>('/suppliers',{name:`Supplier ${suffix}`,note:'Morning delivery'},undefined,'POST',201);
  const receiptKey=randomUUID(),receiptBody={locationId:main.id,supplierId:supplier.id,reference:`DEL-${suffix}`,reason:'Delivery received',lines:[{productId:coffee.id,quantity:20},{productId:milk.id,quantity:10}]};
  const receipt=await request<StockOperation>('/receipts',receiptBody,receiptKey);assert.equal(receipt.status,'COMMITTED');assert.deepEqual(await request('/receipts',receiptBody,receiptKey),receipt);
  await request('/receipts',{...receiptBody,locationId:bar.id},receiptKey,'POST',409);
  const transfer=await request<StockOperation>('/transfers',{locationId:main.id,destinationLocationId:bar.id,reference:`TR-${suffix}`,reason:'Prepare bar stock',lines:[{productId:coffee.id,quantity:5},{productId:milk.id,quantity:2}]},randomUUID());
  assert.equal(transfer.movements.length,4);assert.equal(await stock(coffee.id,main.id),15);assert.equal(await stock(milk.id,main.id),8);assert.equal(await stock(coffee.id,bar.id),5);assert.equal(await stock(milk.id,bar.id),2);
  const menu=await request<MenuItem>('/menu-items',{name:`Latte ${suffix}`,category:'Coffee',priceMinor:400,currency:'USD',ingredients:[{productId:coffee.id,quantity:.018},{productId:milk.id,quantity:.2}]},undefined,'POST',201);
  const createKey=randomUUID(),draft=await request<Sale>('/sales',{locationId:bar.id,lines:[{menuItemId:menu.id,quantity:3}]},createKey);assert.equal(draft.totalMinor,1200);
  assert.equal((await request<Sale>('/sales',{locationId:bar.id,lines:[{menuItemId:menu.id,quantity:3}]},createKey)).id,draft.id);
  const checkoutKey=randomUUID(),checkoutBody={expectedVersion:draft.version,tender:'CASH'};
  let sale=await request<Sale>(`/sales/${draft.id}/checkout`,checkoutBody,checkoutKey);if(sale.status==='CHECKOUT_PENDING')sale=await terminal(sale.id);assert.equal(sale.status,'COMPLETED');
  assert.deepEqual(await request(`/sales/${draft.id}/checkout`,checkoutBody,checkoutKey),sale);assert.equal(await stock(coffee.id,bar.id),4.946);assert.equal(await stock(milk.id,bar.id),1.4);
  const printed=await request<Sale&{issuedAt:string}>(`/sales/${sale.id}/receipt`);assert.equal(printed.receiptReference,sale.receiptReference);assert.equal(printed.totalMinor,1200);
  const waste=await request<StockOperation>('/waste',{locationId:bar.id,reference:`WASTE-${suffix}`,reason:'Spilled milk',wasteCategory:'PREPARATION',lines:[{productId:milk.id,quantity:.1}]},randomUUID());assert.equal(await stock(milk.id,bar.id),1.3);
  const count=await request<StockCount>('/counts',{locationId:bar.id,productIds:[coffee.id,milk.id],reason:'Physical count'},randomUUID());
  const counted=await request<StockCount>(`/counts/${count.id}`,{expectedVersion:count.version,lines:[{productId:coffee.id,countedQuantity:4.9},{productId:milk.id,countedQuantity:1.25}]},undefined,'PATCH');
  assert.equal(counted.lines.find(row=>row.productId===coffee.id)?.differenceQuantity,-.046);assert.equal(counted.lines.find(row=>row.productId===milk.id)?.differenceQuantity,-.05);
  const countKey=randomUUID(),adjust=await request<StockOperation>(`/counts/${count.id}/apply`,{expectedVersion:counted.version},countKey);assert.equal(adjust.status,'COMMITTED');assert.deepEqual(await request(`/counts/${count.id}/apply`,{expectedVersion:counted.version},countKey),adjust);assert.equal((await request<StockCount>(`/counts/${count.id}`)).status,'APPLIED');
  assert.equal(await stock(coffee.id,bar.id),4.9);assert.equal(await stock(milk.id,bar.id),1.25);
  await request('/replenishment-rules',{locationId:bar.id,productId:milk.id,lowStockThreshold:1.5,targetQuantity:3,expectedVersion:null});
  const replenishment=await request<Items<ReplenishmentItem>>(`/replenishment?locationId=${bar.id}`);assert.equal(replenishment.items.find(row=>row.product.id===milk.id)?.suggestedQuantity,1.75);
  const shortDraft=await request<Sale>('/sales',{locationId:bar.id,lines:[{menuItemId:menu.id,quantity:7}]},randomUUID());
  const rejected=await request<Sale>(`/sales/${shortDraft.id}/checkout`,{expectedVersion:shortDraft.version,tender:'CARD'},randomUUID());assert.equal(rejected.status,'REJECTED');assert.equal(rejected.error?.code,'INSUFFICIENT_STOCK');assert.equal(await stock(coffee.id,bar.id),4.9);assert.equal(await stock(milk.id,bar.id),1.25);
  const refundKey=randomUUID(),refundBody={lines:[{saleLineId:sale.lines[0].id,quantity:1}],reason:'Guest correction',restock:false};
  const refund=await request<Refund>(`/sales/${sale.id}/refunds`,refundBody,refundKey);assert.equal(refund.status,'COMPLETED');assert.equal(refund.amountMinor,400);assert.equal((await request<Refund>(`/sales/${sale.id}/refunds`,refundBody,refundKey)).id,refund.id);assert.equal(await stock(milk.id,bar.id),1.25);
  const to=new Date(Date.now()+1000).toISOString(),query=new URLSearchParams({from,to,locationId:bar.id}).toString();
  const report=await request<SalesReport>(`/reports/sales?${query}&limit=1`);assert.equal(report.grossMinor,1200);assert.equal(report.refundMinor,400);assert.equal(report.netMinor,800);assert.equal(report.completedSales,1);assert.equal(report.items.length,1);assert.ok(report.nextCursor);
  const inventory=await request<InventoryReport>(`/reports/inventory?${query}`);assert.equal(inventory.products.find(row=>row.productId===milk.id)?.wasteQuantity,.1);assert.equal(inventory.products.find(row=>row.productId===coffee.id)?.consumedQuantity,.054);assert.equal(inventory.products.find(row=>row.productId===milk.id)?.countVariance,-.05);
  for(const kind of ['inventory','sales']){const exported=await fetch(`${base}/reports/${kind}/export?${query}`);assert.equal(exported.status,200);assert.match(exported.headers.get('content-type')??'',/^text\/csv/);assert.ok((await exported.text()).includes(kind==='sales'?sale.receiptReference!:milk.name));}
  const changed=await request<MenuItem>(`/menu-items/${menu.id}/publish`,{name:menu.name,category:menu.category,priceMinor:450,currency:'USD',expectedVersion:menu.version,ingredients:[{productId:coffee.id,quantity:.03},{productId:milk.id,quantity:.3}]});assert.equal(changed.recipeRevision,2);
  const restock=await request<Refund>(`/sales/${sale.id}/refunds`,{lines:[{saleLineId:sale.lines[0].id,quantity:1}],reason:'Ingredients returned',restock:true},randomUUID());assert.equal(restock.status,'COMPLETED');assert.equal(restock.amountMinor,400);assert.equal(await stock(coffee.id,bar.id),4.918);assert.equal(await stock(milk.id,bar.id),1.45);
  await request(`/sales/${sale.id}/refunds`,{lines:[{saleLineId:sale.lines[0].id,quantity:2}],reason:'Excess correction',restock:true},randomUUID(),'POST',409);
  const stale=await request<StockCount>('/counts',{locationId:bar.id,productIds:[coffee.id],reason:'Stale count test'},randomUUID());
  const staleEdited=await request<StockCount>(`/counts/${stale.id}`,{expectedVersion:stale.version,lines:[{productId:coffee.id,countedQuantity:4}]},undefined,'PATCH');
  await request('/waste',{locationId:bar.id,reference:`WASTE-STALE-${suffix}`,reason:'Count changed by movement',wasteCategory:'OTHER',lines:[{productId:coffee.id,quantity:.001}]},randomUUID());
  const staleKey=randomUUID();await request(`/counts/${stale.id}/apply`,{expectedVersion:staleEdited.version},staleKey,'POST',409);assert.equal((await request<StockOperation>(`/stock-operations/${staleKey}`)).error?.code,'COUNT_STALE');assert.equal(await stock(coffee.id,bar.id),4.917);
  const mongo=await MongoClient.connect(process.env.MONGO_URI??'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true');
  try{
    assert.equal(await mongo.db('stockflow_sales').collection('receipts').countDocuments({saleId:sale.id}),1);
    const stockEvents=await mongo.db('stockflow_inventory').collection('outbox').find({'payload.productId':{$in:[coffee.id,milk.id]}}).toArray();
    const salesEvents=await mongo.db('stockflow_sales').collection('outbox').find({'payload.saleId':sale.id}).toArray();assert.equal(salesEvents.length,3);
    for(let attempt=0;attempt<80;attempt++){const auditedStock=await mongo.db('stockflow_audit').collection('stock_events').countDocuments({_id:{$in:stockEvents.map(row=>row._id)}}),auditedSales=await mongo.db('stockflow_audit').collection('sales_events').countDocuments({_id:{$in:salesEvents.map(row=>row.eventId)}});if(auditedStock===stockEvents.length&&auditedSales===salesEvents.length)break;assert.ok(attempt<79,'All committed stock and sales events must reach Audit');await new Promise(resolve=>setTimeout(resolve,250));}
    const evidence={fixture:suffix,from,coffeeId:coffee.id,milkId:milk.id,mainId:main.id,barId:bar.id,menuId:menu.id,saleId:sale.id,receipt: sale.receiptReference,receiptId:receipt.id,transferId:transfer.id,wasteId:waste.id,countId:count.id,refundId:refund.id,restockId:restock.id,stockEvents:stockEvents.length,salesEvents:salesEvents.length};mkdirSync('output',{recursive:true});writeFileSync('output/expansion-demo.json',JSON.stringify(evidence,null,2));console.log('PASS expanded live BFF workflow, stock precision, whole-bundle shortage, immutable restock, stale count, CSV, persistent documents and audit:',JSON.stringify(evidence));
  }finally{await mongo.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
