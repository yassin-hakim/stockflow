import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { MongoClient } from 'mongodb';
import { connect } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { migrateInventory } from '../apps/inventory-service/src/infrastructure/inventory-migration';
import { changeStock } from '../apps/inventory-service/src/domain/stock';
import { toPersistedChange } from '../apps/inventory-service/src/application/stock-use-cases';
import { DEFAULT_LOCATION_ID } from '../apps/inventory-service/src/domain/operations';
import { STOCK_STREAM_CONFIG, AUDIT_CONSUMER_CONFIG, SALES_STREAM_CONFIG, SALES_AUDIT_CONSUMER_CONFIG } from './lib/nats-configuration';

// Only new database names, unused ports, and processes spawned by this verifier are touched.
const sourceRoot = resolve(process.env.REVIEW_SOURCE_ROOT ?? '.tools/expansion-review-20261006');
const runId = randomUUID().replaceAll('-','');
const artifactRoot = resolve('output/verification',`runtime-${runId}`);
const databases = Object.fromEntries(['product','inventory','sales','audit'].map(owner=>[owner,`stockflow_runtime_${runId}_${owner}`]));
const uri = (owner:string)=>`mongodb://127.0.0.1:27017/${databases[owner]}?replicaSet=rs0&directConnection=true`;
const ports = {bff:3100,product:3101,inventory:3102,sales:3103,fault:3104,web:4300,nats:14222,monitor:18222};
const natsUrl = `nats://127.0.0.1:${ports.nats}`;
const children = new Map<string,ChildProcess>();
let proxy:Server|undefined, web:Server|undefined;
let fault:'normal'|'before'|'after' = 'normal';
let lostCommittedResponse = false;
const delay = (ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(label:string, predicate:()=>Promise<boolean>, timeout=30000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){try{if(await predicate())return;}catch{}await delay(150);}
  throw new Error(`Timed out: ${label}`);
}
async function available(port:number){
  const server=createServer();
  await new Promise<void>((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',resolve));
  await new Promise<void>(resolve=>server.close(()=>resolve()));
}
function child(name:string, executable:string,args:string[],env:Record<string,string>={}) {
  const log=resolve(artifactRoot,`${name}-${Date.now()}.log`);
  const proc=spawn(executable,args,{cwd:sourceRoot,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
  children.set(name,proc);
  proc.stdout!.on('data',data=>appendFileSync(log,data));proc.stderr!.on('data',data=>appendFileSync(log,data));
  proc.on('error',error=>appendFileSync(log,String(error)));
  return proc;
}
async function stop(name:string){
  const proc=children.get(name);if(!proc)return;
  if(proc.exitCode===null && proc.signalCode===null){const done=new Promise<void>(resolve=>proc.once('exit',()=>resolve()));proc.kill();await Promise.race([done,delay(5000)]);}
  assert(proc.exitCode!==null||proc.signalCode!==null,`${name} did not stop`);children.delete(name);
}
function broker(){
  return child('nats',resolve('.tools/nats/nats-server-v2.15.0-windows-amd64/nats-server.exe'),['-js','-p',String(ports.nats),'-m',String(ports.monitor),'-sd',resolve(artifactRoot,'jetstream')]);
}
async function ready(owner:keyof typeof ports){await until(`${owner} ready`,async()=>{const response=await fetch(`http://127.0.0.1:${ports[owner]}/health/ready`,{signal:AbortSignal.timeout(2000)});return response.ok;});}
function app(owner:'product'|'inventory'|'sales'|'audit'|'bff'){
  const name=owner==='audit'?'audit-worker':owner==='bff'?'bff':`${owner}-service`;
  const env:Record<string,string>={CURRENCY:'USD',NATS_URL:natsUrl,MONGO_URI:uri(owner),MONGO_DB:databases[owner]};
  if(owner!=='audit')env.PORT=String(ports[owner]);
  if(owner==='inventory')env.PRODUCT_SERVICE_URL=`http://127.0.0.1:${ports.product}`;
  if(owner==='sales'){env.PRODUCT_URL=`http://127.0.0.1:${ports.product}`;env.INVENTORY_URL=`http://127.0.0.1:${ports.fault}`;}
  if(owner==='bff'){env.PRODUCT_SERVICE_URL=`http://127.0.0.1:${ports.product}`;env.INVENTORY_SERVICE_URL=`http://127.0.0.1:${ports.inventory}`;env.SALES_SERVICE_URL=`http://127.0.0.1:${ports.sales}`;}
  return child(owner,process.execPath,[resolve(sourceRoot,'apps',name,'dist/main.js')],env);
}
function forward(req:any,res:any,port:number,lose=false){
  const upstream=httpRequest({host:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}},response=>{
    if(lose){response.resume();response.on('end',()=>{lostCommittedResponse=true;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'UPSTREAM_UNAVAILABLE',message:'Injected lost Inventory response.'}}));});}
    else{res.writeHead(response.statusCode!,response.headers);response.pipe(res);}
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});req.pipe(upstream);
}
async function http(path:string,method='GET',body?:unknown,key?:string){
  const response=await fetch(`http://127.0.0.1:${ports.bff}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  const data:any=await response.json();assert(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return {status:response.status,data};
}
async function main(){
  mkdirSync(artifactRoot,{recursive:true});
  for(const port of Object.values(ports))await available(port);
  for(const owner of ['bff','product-service','inventory-service','sales-service','audit-worker'])assert(existsSync(resolve(sourceRoot,'apps',owner,'dist/main.js')),`Build review source first: ${owner}`);
  const mongo=await MongoClient.connect(uri('inventory'));
  const inventory=mongo.db(databases.inventory),sales=mongo.db(databases.sales),audit=mongo.db(databases.audit);
  try{
    const legacyProduct=randomUUID(),legacyKey=randomUUID();
    const legacyCommand={productId:legacyProduct,type:'ADD' as const,quantityMillis:40000,reason:'Migrated browser command',idempotencyKey:legacyKey};
    const change=changeStock(null,legacyCommand),persisted=toPersistedChange(change);
    const legacyResult={productId:legacyProduct,quantity:40,movement:{id:change.movement.id,productId:legacyProduct,type:'ADD',quantity:40,reason:legacyCommand.reason,createdAt:change.movement.createdAt}};
    await mongo.db(databases.product).collection('products').insertOne({_id:legacyProduct as any,name:'Migrated Coffee',unit:'kg',category:'Verification',lowStockThresholdMillis:5000,createdAt:change.item.createdAt,updatedAt:change.item.updatedAt});
    await inventory.collection('inventory').insertOne({_id:legacyProduct as any,...change.item});
    await inventory.collection('inventory').createIndex({productId:1},{unique:true});
    await inventory.collection('stock_movements').insertOne({_id:change.movement.id as any,...change.movement,resultingQuantityMillis:40000,idempotencyKey:legacyKey,command:legacyCommand,result:legacyResult});
    await inventory.collection('stock_movements').createIndex({idempotencyKey:1},{unique:true});
    await inventory.collection('outbox').insertOne({_id:persisted.event.eventId as any,subject:persisted.subject,payload:persisted.event,status:'PENDING',attempts:0,nextAttemptAt:new Date(),createdAt:new Date(persisted.event.occurredAt)});
    assert.equal((await migrateInventory(mongo)).migrated,true);assert.equal((await migrateInventory(mongo)).migrated,false);
    broker();await until('isolated NATS ready',async()=>{const response=await fetch(`http://127.0.0.1:${ports.monitor}/healthz`);return response.ok;});
    let nats=await connect({servers:natsUrl});
    const manager=await jetstreamManager(nats);
    await manager.streams.add(STOCK_STREAM_CONFIG);await manager.consumers.add(STOCK_STREAM_CONFIG.name!,AUDIT_CONSUMER_CONFIG);
    await manager.streams.add(SALES_STREAM_CONFIG);await manager.consumers.add(SALES_STREAM_CONFIG.name!,SALES_AUDIT_CONSUMER_CONFIG);
    await nats.drain();
    proxy=createServer((req,res)=>{
      if(fault==='before'||(fault==='after'&&lostCommittedResponse&&req.method!=='POST')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'UPSTREAM_UNAVAILABLE',message:'Injected Inventory outage.'}}));return;}
      forward(req,res,ports.inventory,fault==='after' && req.method==='POST');
    });await new Promise<void>(resolve=>proxy!.listen(ports.fault,'127.0.0.1',resolve));
    app('product');await ready('product');app('inventory');await ready('inventory');app('sales');await ready('sales');app('bff');await ready('bff');app('audit');
    assert.deepEqual((await http(`/api/inventory/${legacyProduct}/add`,'POST',{quantity:40,reason:legacyCommand.reason},legacyKey)).data,legacyResult);
    assert.equal(await inventory.collection('stock_movements').countDocuments({productId:legacyProduct}),1);
    await until('migrated v1 audited',async()=>await audit.collection('stock_events').countDocuments({_id:persisted.event.eventId as any})===1);
    process.stdout.write('Fresh runtime and migrated v1 replay/audit passed.\n');
    const product=(await http('/api/products','POST',{name:'Runtime cost ingredient',unit:'kg',category:'Verification',lowStockThreshold:0})).data;
    const received=(await http('/api/receipts','POST',{locationId:DEFAULT_LOCATION_ID,reference:'Runtime delivery',reason:'Runtime verification',lines:[{productId:product.id,quantity:5,unitCostMinor:1000}]},randomUUID())).data;
    const menu=(await http('/api/menu-items','POST',{name:'Runtime espresso',category:'Verification',priceMinor:500,currency:'USD',ingredients:[{productId:product.id,quantity:0.1}]})).data;
    const draft=async()=> (await http('/api/sales','POST',{locationId:DEFAULT_LOCATION_ID,lines:[{menuItemId:menu.id,quantity:1}]},randomUUID())).data;
    const checkout=async(sale:any,key=randomUUID())=>http(`/api/sales/${sale.id}/checkout`,'POST',{expectedVersion:sale.version,tender:'CASH'},key);
    const recover=async(id:string)=>{await until('Sales recovery',async()=>(await http(`/api/sales/${id}`)).data.status==='COMPLETED');};
    const before=await draft();fault='before';assert.equal((await checkout(before)).data.status,'CHECKOUT_PENDING');
    await stop('sales');fault='normal';app('sales');await ready('sales');await recover(before.id);
    process.stdout.write('Actual Sales process restart before dispatch recovered.\n');
    const after=await draft(),afterKey=randomUUID();fault='after';assert.equal((await checkout(after,afterKey)).data.status,'CHECKOUT_PENDING');
    assert.equal(await inventory.collection('stock_commands').countDocuments({'command.reference':after.id,'result.status':'COMMITTED'}),1);
    await stop('sales');
    await http(`/api/menu-items/${menu.id}/publish`,'POST',{name:menu.name,category:menu.category,priceMinor:900,currency:'USD',ingredients:[{productId:product.id,quantity:0.4}],expectedVersion:menu.version});
    fault='normal';app('sales');await ready('sales');await recover(after.id);
    const recovered=(await http(`/api/sales/${after.id}`)).data;assert.equal(recovered.totalMinor,500);assert.equal(recovered.lines[0].ingredients[0].quantity,0.1);
    const {refunds: _currentCorrections, ...recordedCheckout} = recovered;
    assert.deepEqual((await checkout(after,afterKey)).data,recordedCheckout);
    for(const id of [before.id,after.id]){const recorded=(await http(`/api/sales/${id}`)).data;assert.equal(await sales.collection('receipts').countDocuments({saleId:id}),1);assert.equal(await sales.collection('outbox').countDocuments({'payload.saleId':id}),1);assert.equal(await inventory.collection('stock_movements').countDocuments({operationId:recorded.operationId,cause:'SALE'}),1);}
    process.stdout.write('Actual Inventory commit/lost response/Sales restart recovered with frozen recipe and price.\n');
    await stop('nats');
    const offlineReceipt=(await http('/api/receipts','POST',{locationId:DEFAULT_LOCATION_ID,reference:'Offline broker delivery',reason:'Broker recovery',lines:[{productId:product.id,quantity:1,unitCostMinor:1000}]},randomUUID())).data;
    const offlineSale=await draft();assert.equal((await checkout(offlineSale)).data.status,'COMPLETED');
    assert.equal(await sales.collection('outbox').countDocuments({'payload.saleId':offlineSale.id,publishedAt:null}),1);
    assert.equal(await inventory.collection('outbox').countDocuments({'payload.operationId':offlineReceipt.id,status:'PENDING'}),1);
    broker();await until('broker restored',async()=>(await fetch(`http://127.0.0.1:${ports.monitor}/healthz`)).ok);
    await until('stock and Sales audit after broker outage',async()=>await audit.collection('sales_events').countDocuments({'event.saleId':offlineSale.id})===1&&await audit.collection('stock_events').countDocuments({'event.operationId':offlineReceipt.id})===1);
    await stop('audit');const workerSale=await draft();assert.equal((await checkout(workerSale)).data.status,'COMPLETED');
    await until('Sales published while worker stopped',async()=>await sales.collection('outbox').countDocuments({'payload.saleId':workerSale.id,publishedAt:{$ne:null}})===1);
    assert.equal(await audit.collection('sales_events').countDocuments({'event.saleId':workerSale.id}),0);
    app('audit');await until('worker caught up',async()=>await audit.collection('sales_events').countDocuments({'event.saleId':workerSale.id})===1);
    // Real isolated Audit storage rejection must be retried, not acknowledged as successful.
    await audit.command({collMod:'sales_events',validator:{'event.locationId':{$ne:DEFAULT_LOCATION_ID}},validationAction:'error'});
    const storageSale=await draft();assert.equal((await checkout(storageSale)).data.status,'COMPLETED');
    await until('Sales event published during Audit storage fault',async()=>await sales.collection('outbox').countDocuments({'payload.saleId':storageSale.id,publishedAt:{$ne:null}})===1);
    await delay(1500);assert.equal(await audit.collection('sales_events').countDocuments({'event.saleId':storageSale.id}),0);
    await audit.command({collMod:'sales_events',validator:{}});
    await until('Audit storage fault recovered',async()=>await audit.collection('sales_events').countDocuments({'event.saleId':storageSale.id})===1);
    nats=await connect({servers:natsUrl});
    const stockEvents=await inventory.collection('outbox').find().toArray(),saleEvents=await sales.collection('outbox').find().toArray();
    for(const row of [...stockEvents,...saleEvents])await jetstream(nats).publish(row.subject,new TextEncoder().encode(JSON.stringify(row.payload)),{msgID:randomUUID()});
    await until('duplicate deliveries acknowledged',async()=>{const mgr=await jetstreamManager(nats);const a=await mgr.consumers.info('STOCK_EVENTS','stock-audit'),b=await mgr.consumers.info('SALES_EVENTS','sales-audit');return a.num_pending===0&&a.num_ack_pending===0&&b.num_pending===0&&b.num_ack_pending===0;});
    await nats.drain();
    assert.equal(await audit.collection('stock_events').countDocuments(),stockEvents.length);assert.equal(await audit.collection('sales_events').countDocuments(),saleEvents.length);
    assert.equal(stockEvents.filter(row=>row.payload.schemaVersion===1).length,1);assert(stockEvents.some(row=>row.payload.schemaVersion===2));
    const staticRoot=resolve(sourceRoot,'apps/frontend/dist/frontend/browser');
    web=createServer((req,res)=>{if(req.url?.startsWith('/api/')){forward(req,res,ports.bff);return;}let path=resolve(staticRoot,'.'+decodeURIComponent(new URL(req.url??'/','http://localhost').pathname));if(!path.startsWith(staticRoot+sep)||!existsSync(path)||!extname(path))path=resolve(staticRoot,'index.html');const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};try{res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream'});res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}});
    await new Promise<void>(resolve=>web!.listen(ports.web,'127.0.0.1',resolve));
    assert((await fetch(`http://127.0.0.1:${ports.web}/inventory`)).ok);
    const evidence={runId,sourceRoot,databases,ports,legacy:{productId:legacyProduct,key:legacyKey,quantity:40,reason:legacyCommand.reason,eventId:persisted.event.eventId},productId:product.id,menuId:menu.id,received:received.id,sales:[before.id,after.id,offlineSale.id,workerSale.id,storageSale.id],stockEvents:stockEvents.length,salesEvents:saleEvents.length,assertions:['pre-migration exact replay','migration rerun','v1/v2 eventual audit and dedup','Sales crash before dispatch','Sales crash after actual Inventory commit','frozen recipe and price','one receipt/consumption/event per sale','NATS offline business commits and audit recovery','Audit process restart recovery','real Audit Mongo validation failure recovery','clean source six-process runtime and built frontend'],completedAt:new Date().toISOString()};
    writeFileSync(resolve(artifactRoot,'evidence.json'),JSON.stringify(evidence,null,2));writeFileSync(resolve('output/verification/fresh-expansion-runtime.json'),JSON.stringify(evidence,null,2));
    process.stdout.write(`Runtime verification passed: ${JSON.stringify(evidence)}\n`);
    if(process.argv.includes('--serve')){process.stdout.write('Review browser ready at http://localhost:4300; Ctrl+C closes only verifier-owned processes.\n');await new Promise<void>(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
  }finally{
    for(const name of [...children.keys()].reverse())await stop(name);
    for(const server of [web,proxy])if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
    await mongo.close();
  }
}
void main().catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:String(error)}\n`);process.exitCode=1;});
