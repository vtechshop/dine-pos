/**
 * Migration: convert AuditLog.hotelId and ChatMessage.hotelId from BSON String to ObjectId.
 *
 * WHY: Both models were historically created with `{ type: String }` for hotelId while
 * all other tenant models use `{ type: Schema.Types.ObjectId }`. This mismatch means
 * any $lookup join with the Hotel collection fails silently, and any code that passes
 * new mongoose.Types.ObjectId(id) to a query returns empty results.
 *
 * WHEN TO RUN: Run this BEFORE deploying the code that changes AuditLog.ts and
 * ChatMessage.ts schemas to ObjectId. Deploying the schema change without migrating
 * the data first will cause all existing audit log and chat message queries to return
 * empty results (ObjectId != String in MongoDB BSON comparison).
 *
 * HOW TO RUN:
 *   node scripts/migrate-hotelid-to-objectid.js
 *
 * Or paste the raw MongoDB commands into mongosh directly:
 *
 *   use <your-database-name>
 *
 *   db.auditlogs.updateMany(
 *     { hotelId: { $type: 'string' } },
 *     [{ $set: { hotelId: { $toObjectId: '$hotelId' } } }]
 *   );
 *
 *   db.chatmessages.updateMany(
 *     { hotelId: { $type: 'string' } },
 *     [{ $set: { hotelId: { $toObjectId: '$hotelId' } } }]
 *   );
 *
 * SAFETY:
 * - The $type: 'string' filter ensures already-migrated ObjectId documents are skipped.
 * - Re-running is safe (idempotent).
 * - $toObjectId will throw inside the pipeline if hotelId is not a valid 24-char hex
 *   string. Invalid values would indicate data corruption and must be investigated
 *   manually before migrating.
 *
 * ESTIMATED DURATION: Fast for typical volumes (<100k documents). Large collections
 * (>1M documents) may take a few minutes. The update runs without locking reads.
 *
 * ROLLBACK: There is no automatic rollback. If you need to revert, run:
 *   db.auditlogs.updateMany(
 *     { hotelId: { $type: 'objectId' } },
 *     [{ $set: { hotelId: { $toString: '$hotelId' } } }]
 *   );
 *   // same for chatmessages
 * Then redeploy the previous code version.
 */

'use strict';

const mongoose = require('mongoose');

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI env var is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  console.log('Starting hotelId type migration...');

  // ── auditlogs ─────────────────────────────────────────────────────────────
  const auditResult = await db.collection('auditlogs').updateMany(
    { hotelId: { $type: 'string' } },
    [{ $set: { hotelId: { $toObjectId: '$hotelId' } } }],
  );
  console.log(`auditlogs: matched=${auditResult.matchedCount}, modified=${auditResult.modifiedCount}`);

  // ── chatmessages ──────────────────────────────────────────────────────────
  const chatResult = await db.collection('chatmessages').updateMany(
    { hotelId: { $type: 'string' } },
    [{ $set: { hotelId: { $toObjectId: '$hotelId' } } }],
  );
  console.log(`chatmessages: matched=${chatResult.matchedCount}, modified=${chatResult.modifiedCount}`);

  console.log('Migration complete.');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
