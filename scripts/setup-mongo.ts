import { MongoClient } from 'mongodb';

async function main(): Promise<void> {
  const client = await MongoClient.connect(process.env.MONGO_ADMIN_URI ?? 'mongodb://localhost:27017/?directConnection=true', { serverSelectionTimeoutMS: 5000 });
  try {
    const admin = client.db('admin');
    try {
      const status = await admin.command({ replSetGetStatus: 1 });
      if (status.set !== 'rs0') throw new Error(`Existing replica set is ${status.set}, expected rs0.`);
      process.stdout.write('MongoDB replica set rs0 is already initialized.\n');
    } catch (error) {
      if (!(error instanceof Error) || !/not yet initialized|no replset config has been received|NotYetInitialized/i.test(error.message)) throw error;
      await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] } });
      process.stdout.write('MongoDB replica set rs0 initialized.\n');
    }
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const hello = await admin.command({ hello: 1 });
      if (hello.isWritablePrimary === true) {
        process.stdout.write('MongoDB replica set rs0 is writable and ready.\n');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('rs0 did not elect a writable primary within 30 seconds. Check docker compose logs mongo.');
  } finally { await client.close(); }
}
void main().catch(error => {
  process.stderr.write(`MongoDB setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
