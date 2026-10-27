const { MongoClient } = require('mongodb');

const LOCAL = 'mongodb://localhost:27017/hotelbillingpos';
// Target comes from the environment — never commit a connection string here.
// (A production URI was previously hardcoded in this file; it must be rotated.)
const ATLAS = process.env.MIGRATE_TARGET_URI;
if (!ATLAS) {
  console.error('Set MIGRATE_TARGET_URI to the destination MongoDB URI.');
  process.exit(1);
}

async function migrate() {
  console.log('Connecting to local MongoDB...');
  const localClient = new MongoClient(LOCAL);
  await localClient.connect();
  const localDb = localClient.db('hotelbillingpos');

  console.log('Connecting to Atlas...');
  const atlasClient = new MongoClient(ATLAS);
  await atlasClient.connect();
  const atlasDb = atlasClient.db('hotelbillingpos');

  const collections = await localDb.listCollections().toArray();
  console.log(`Found ${collections.length} collections:`, collections.map(c => c.name));

  for (const col of collections) {
    const name = col.name;
    const docs = await localDb.collection(name).find({}).toArray();
    if (docs.length === 0) { console.log(`  ${name}: empty, skipping`); continue; }

    await atlasDb.collection(name).deleteMany({});
    await atlasDb.collection(name).insertMany(docs);
    console.log(`  ✅ ${name}: ${docs.length} documents migrated`);
  }

  console.log('\n✅ Migration complete!');
  await localClient.close();
  await atlasClient.close();
}

migrate().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
