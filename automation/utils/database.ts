import { MongoClient, Db } from 'mongodb';
import { ENV } from './env';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectTestDB(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(ENV.MONGODB_TEST_URI);
  await client.connect();
  db = client.db();
  return db;
}

export async function disconnectTestDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

export async function cleanCollection(collectionName: string): Promise<void> {
  const database = await connectTestDB();
  await database.collection(collectionName).deleteMany({});
}

export async function cleanTestData(prefix: string): Promise<void> {
  const database = await connectTestDB();
  const collections = ['hotels', 'orders', 'products', 'categories', 'tables', 'waiters', 'cashiers', 'refreshtokens', 'settings', 'dailycounters'];
  for (const col of collections) {
    try {
      const collection = database.collection(col);
      if (col === 'hotels') {
        await collection.deleteMany({ phone: { $regex: `^TEST_${prefix}` } });
      } else if (col === 'settings') {
        // Settings are cleaned via hotelId cascade
      } else {
        // Clean any docs referencing test hotels
        await collection.deleteMany({ _testPrefix: prefix });
      }
    } catch {
      // Collection may not exist yet — safe to ignore
    }
  }
}

export async function deleteHotelAndAllData(hotelId: string): Promise<void> {
  const database = await connectTestDB();
  const relatedCollections = [
    'orders', 'products', 'categories', 'tables', 'settings', 'waiters',
    'cashiers', 'refreshtokens', 'auditlegs', 'dailycounters', 'notifications',
    'reservations', 'expenses', 'wastelogs', 'ingredients', 'chatmessages',
  ];
  await Promise.all([
    database.collection('hotels').deleteOne({ _id: hotelId as any }),
    ...relatedCollections.map(c =>
      database.collection(c).deleteMany({ hotelId }).catch(() => {})
    ),
  ]);
}

export async function getTestHotelByPhone(phone: string): Promise<any> {
  const database = await connectTestDB();
  return database.collection('hotels').findOne({ phone });
}
