const { MongoClient } = require('mongodb');

async function main() {
  const client = await MongoClient.connect('mongodb://127.0.0.1:27117/?directConnection=true');
  try {
    const admin = client.db('admin');
    try {
      const status = await admin.command({ replSetGetStatus: 1 });
      if (status.set !== 'rs0') throw new Error('Unexpected replica set.');
    } catch (error) {
      if (error.code !== 94) throw error;
      await admin.command({ replSetInitiate: {
        _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27117' }],
      } });
    }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if ((await admin.command({ hello: 1 })).isWritablePrimary) {
        console.log('StockFlow MongoDB replica set is writable.');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('MongoDB did not become writable.');
  } finally {
    await client.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
