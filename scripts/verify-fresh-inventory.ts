import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { migrateInventory,assertInventorySchema } from '../apps/inventory-service/src/infrastructure/inventory-migration';
import { MongoStockStore } from '../apps/inventory-service/src/infrastructure/mongo-stock-store';
import { DEFAULT_LOCATION_ID } from '../apps/inventory-service/src/domain/operations';
const database=`stockflow_inventory_fresh_${randomUUID().replaceAll('-','')}`;
async function main(){
  const url=new URL(process.env.TEST_MONGO_URI??'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true');url.pathname=`/${database}`;
  const mongo=await MongoClient.connect(url.toString());
  try{
    assert.equal((await mongo.db().listCollections().toArray()).length,0);
    await assert.rejects(()=>assertInventorySchema(mongo),/schema v2/);
    assert.deepEqual(await migrateInventory(mongo),{migrated:true,balances:0,movements:0});await assertInventorySchema(mongo);
    const store=new MongoStockStore(mongo);await store.setup();
    assert.equal(await mongo.db().collection('locations').countDocuments({_id:DEFAULT_LOCATION_ID as any}),1);
    assert.deepEqual(await migrateInventory(mongo),{migrated:false,balances:0,movements:0});
    console.log('PASS fresh collection-free Inventory migration, schema guard, store initialization and repeat migration.');
  }finally{if(database.startsWith('stockflow_inventory_fresh_')&&mongo.db().databaseName===database)await mongo.db().dropDatabase();await mongo.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
