import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

const base = process.env.BFF_URL ?? 'http://localhost:3000/api';
async function call(path: string, body?: unknown, key?: string, expected = 200): Promise<any> {
  const response = await fetch(`${base}${path}`,{ method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type':'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status,expected,JSON.stringify(result)); return result;
}
async function main(): Promise<void> {
  const suffix = randomUUID().slice(0,8), client = await MongoClient.connect('mongodb://localhost:27017/stockflow_inventory?replicaSet=rs0&directConnection=true');
  try {
    const coffee = await call('/products',{name:`Warehouse Coffee ${suffix}`,unit:'kg',category:'Verification',lowStockThreshold:5},undefined,201);
    const milk = await call('/products',{name:`Warehouse Milk ${suffix}`,unit:'L',category:'Verification'},undefined,201);
    const source = await call('/locations',{name:`Store ${suffix}`},undefined,201), bar = await call('/locations',{name:`Bar ${suffix}`},undefined,201);
    const receiptKey = randomUUID(), receipt = {locationId:source.id,lines:[{productId:coffee.id,quantity:20},{productId:milk.id,quantity:10}],reason:'Supplier delivery',reference:`DEL-${suffix}`};
    const received = await call('/receipts',receipt,receiptKey);
    assert.equal(received.movements.length,2); assert.deepEqual(await call('/receipts',receipt,receiptKey),received);
    await call('/receipts',{...receipt,locationId:bar.id},receiptKey,409);
    const transfer = await call('/transfers',{locationId:source.id,destinationLocationId:bar.id,lines:[{productId:coffee.id,quantity:5},{productId:milk.id,quantity:2}],reason:'Bar preparation',reference:`TR-${suffix}`},randomUUID());
    assert.equal(transfer.movements.length,4);
    const quantity = async (productId: string,locationId: string) => (await call(`/stock?locationId=${locationId}`)).items.find((item:any) => item.product.id===productId).quantity;
    assert.equal(await quantity(coffee.id,bar.id),5); assert.equal(await quantity(coffee.id,source.id),15);
    const movementCount = await client.db().collection('stock_movements').countDocuments({productId:{$in:[coffee.id,milk.id]}});
    const rejectionKey = randomUUID();
    await call('/transfers',{locationId:bar.id,destinationLocationId:source.id,lines:[{productId:coffee.id,quantity:1},{productId:milk.id,quantity:3}],reason:'Rejected bundle',reference:'REJECT'},rejectionKey,409);
    assert.equal(await quantity(coffee.id,bar.id),5); assert.equal(await client.db().collection('stock_movements').countDocuments({productId:{$in:[coffee.id,milk.id]}}),movementCount);
    assert.equal((await call(`/stock-operations/${rejectionKey}`)).status,'REJECTED');
    const concurrent = {locationId:bar.id,destinationLocationId:source.id,lines:[{productId:coffee.id,quantity:4}],reason:'Concurrent transfer',reference:'RACE'};
    const responses = await Promise.all([randomUUID(),randomUUID()].map(key => fetch(`${base}/transfers`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(concurrent)})));
    assert.deepEqual(responses.map(value=>value.status).sort(),[200,409]);
    assert.equal(await quantity(coffee.id,bar.id),1); assert.equal(await quantity(coffee.id,source.id),19);
    const history = await call(`/stock/${coffee.id}/movements?limit=2`);
    assert.equal(history.items.length,2); assert.ok(history.nextCursor);
    assert.ok(history.items.every((row:any) => !('_id' in row) && !('command' in row) && !('quantityMillis' in row)));
    const ids = await client.db().collection<any>('outbox').find({'payload.productId':{$in:[coffee.id,milk.id]}}).project({_id:1}).toArray();
    const audit = client.db('stockflow_audit').collection('stock_events');
    const deadline = Date.now()+15000;
    while ((await audit.countDocuments({_id:{$in:ids.map(row=>row._id)}})) < ids.length && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,200));
    assert.equal(await audit.countDocuments({_id:{$in:ids.map(row=>row._id)}}),ids.length);
    process.stdout.write(`Verified receiving/replay, paired transfers, all-or-none rejection, concurrency, bounded history and ${ids.length} v2 audit records; products ${coffee.id}, ${milk.id}.\n`);
  } finally { await client.close(); }
}
void main().catch(error=>{process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);process.exitCode=1;});
