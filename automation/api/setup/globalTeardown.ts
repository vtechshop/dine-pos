import fs from 'fs';
import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

const STATE_FILE = path.resolve(__dirname, '../../.test-state.json');
const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/dinepos_test';

async function deleteHotelCascade(client: MongoClient, hotelId: string): Promise<void> {
  if (!hotelId) return;
  const db = client.db();

  // The state file and ad-hoc hotel IDs are serialized as hex strings.
  // MongoDB stores _id and hotelId refs as BSON ObjectId — a string comparison
  // against an ObjectId field silently matches nothing. Convert before querying.
  let oid: ObjectId | undefined;
  try { oid = new ObjectId(hotelId); } catch { /* not a valid ObjectId — keep as string */ }
  const _id: any = oid ?? hotelId;

  const relatedCollections = [
    'orders', 'products', 'categories', 'tables', 'settings', 'waiters',
    'cashiers', 'refreshtokens', 'auditlegs', 'dailycounters', 'notifications',
    'reservations', 'expenses', 'wastelogs', 'ingredients', 'chatmessages',
  ];
  await Promise.all([
    db.collection('hotels').deleteOne({ _id }),
    ...relatedCollections.map(c =>
      db.collection(c).deleteMany({ hotelId: _id }).catch(() => {})
    ),
  ]);
}

export default async function globalTeardown(): Promise<void> {
  console.log('\n[GlobalTeardown] Cleaning up test data...');

  if (!fs.existsSync(STATE_FILE)) {
    console.log('[GlobalTeardown] No state file found — nothing to clean.');
    return;
  }

  let state: any;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    console.error('[GlobalTeardown] Failed to parse state file — manual cleanup may be required.');
    return;
  }

  const client = new MongoClient(MONGODB_TEST_URI);
  try {
    await client.connect();

    const hotelIds: string[] = [];
    if (state.hotelA?.hotelId) hotelIds.push(state.hotelA.hotelId);
    if (state.hotelB?.hotelId) hotelIds.push(state.hotelB.hotelId);
    if (state.pendingHotel?.hotelId) hotelIds.push(state.pendingHotel.hotelId);

    // Delete any ad-hoc hotels created during tests (phone prefix 8xxx)
    const db = client.db();
    const adHocHotels = await db.collection('hotels')
      .find({ phone: { $regex: '^8[0-9]{9}$' } })
      .project({ _id: 1 })
      .toArray();
    for (const h of adHocHotels) {
      hotelIds.push(h._id.toString());
    }

    await Promise.all(hotelIds.map(id => deleteHotelCascade(client, id)));
    console.log(`[GlobalTeardown] Deleted ${hotelIds.length} hotel(s) and all related data.`);
  } catch (err) {
    console.error('[GlobalTeardown] DB cleanup error:', err);
  } finally {
    await client.close();
  }

  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // already gone
  }

  console.log('[GlobalTeardown] Teardown complete.\n');
}
