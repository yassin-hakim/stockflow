import { MongoClient } from 'mongodb';
import { migrateInventory } from '../apps/inventory-service/src/infrastructure/inventory-migration';

async function main(): Promise<void> {
  const client = await MongoClient.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/stockflow_inventory?replicaSet=rs0&directConnection=true');
  try { process.stdout.write(`${JSON.stringify(await migrateInventory(client))}\n`); }
  finally { await client.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
