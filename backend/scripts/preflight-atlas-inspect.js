/**
 * READ-ONLY Atlas preflight inspection — runs via mongosh.
 * Does NOT modify any data or indexes.
 *
 * Usage:
 *   mongosh "mongodb+srv://hotel-cluster.lrkxckp.mongodb.net/hotelbillingpos" \
 *     --apiVersion 1 --username dineposbill_db_user \
 *     --file scripts/preflight-atlas-inspect.js
 */

const db = db.getSiblingDB('hotelbillingpos');

print('\n========================================');
print('ATLAS PREFLIGHT INSPECTION — READ ONLY');
print('========================================');

// ── A) AuditLog hotelId ──────────────────────────────────────────────────
const auditTotal   = db.auditlogs.countDocuments({});
const auditString  = db.auditlogs.countDocuments({ hotelId: { $type: 'string' } });
const auditOid     = db.auditlogs.countDocuments({ hotelId: { $type: 'objectId' } });
const auditMissing = db.auditlogs.countDocuments({ $or: [{ hotelId: { $exists: false } }, { hotelId: null }] });

const auditInvalidArr = db.auditlogs.aggregate([
  { $match: { hotelId: { $type: 'string' } } },
  { $match: { $expr: { $not: { $regexMatch: { input: '$hotelId', regex: '^[0-9a-fA-F]{24}$' } } } } },
  { $count: 'count' },
]).toArray();
const auditInvalid = auditInvalidArr.length > 0 ? auditInvalidArr[0].count : 0;

print('\n--- A) AuditLog hotelId type distribution ---');
print('  Total documents     : ' + auditTotal);
print('  BSON ObjectId       : ' + auditOid);
print('  BSON String         : ' + auditString + (auditString > 0 ? '  <-- requires migration' : ''));
print('    of which INVALID  : ' + auditInvalid + (auditInvalid > 0 ? '  <-- BLOCKS migration' : '  (none)'));
print('  Missing / null      : ' + auditMissing);

// ── B) ChatMessage hotelId ───────────────────────────────────────────────
const chatTotal   = db.chatmessages.countDocuments({});
const chatString  = db.chatmessages.countDocuments({ hotelId: { $type: 'string' } });
const chatOid     = db.chatmessages.countDocuments({ hotelId: { $type: 'objectId' } });
const chatMissing = db.chatmessages.countDocuments({ $or: [{ hotelId: { $exists: false } }, { hotelId: null }] });

const chatInvalidArr = db.chatmessages.aggregate([
  { $match: { hotelId: { $type: 'string' } } },
  { $match: { $expr: { $not: { $regexMatch: { input: '$hotelId', regex: '^[0-9a-fA-F]{24}$' } } } } },
  { $count: 'count' },
]).toArray();
const chatInvalid = chatInvalidArr.length > 0 ? chatInvalidArr[0].count : 0;

print('\n--- B) ChatMessage hotelId type distribution ---');
print('  Total documents     : ' + chatTotal);
print('  BSON ObjectId       : ' + chatOid);
print('  BSON String         : ' + chatString + (chatString > 0 ? '  <-- requires migration' : ''));
print('    of which INVALID  : ' + chatInvalid + (chatInvalid > 0 ? '  <-- BLOCKS migration' : '  (none)'));
print('  Missing / null      : ' + chatMissing);

// ── C) Orders indexes ────────────────────────────────────────────────────
const orderIndexes = db.orders.getIndexes();
let hasOldOfflineId = false;
let hasCompoundOfflineId = false;

print('\n--- C) Orders — offlineId index status ---');
for (const idx of orderIndexes) {
  const keys = Object.keys(idx.key);
  if (keys.length === 1 && idx.key.offlineId !== undefined) {
    hasOldOfflineId = true;
    print('  [OLD] offlineId_1 global unique  : EXISTS — must drop before deploy');
    print('        name=' + idx.name + '  unique=' + !!idx.unique + '  sparse=' + !!idx.sparse);
  }
  if (idx.key.hotelId !== undefined && idx.key.offlineId !== undefined && keys.length === 2) {
    hasCompoundOfflineId = true;
    print('  [NEW] {hotelId,offlineId} compound: EXISTS  unique=' + !!idx.unique + '  sparse=' + !!idx.sparse);
    print('        name=' + idx.name);
  }
}
if (!hasOldOfflineId) print('  [OLD] offlineId_1 global unique  : NOT PRESENT (good)');
if (!hasCompoundOfflineId) print('  [NEW] {hotelId,offlineId} compound: NOT PRESENT — must create before deploy');

print('\n  Full orders index list:');
for (const idx of orderIndexes) {
  print('    ' + JSON.stringify(idx.key) + '  unique=' + !!idx.unique + '  sparse=' + !!idx.sparse + '  name=' + idx.name);
}

// ── D) Payments indexes ──────────────────────────────────────────────────
const paymentIndexes = db.payments.getIndexes();
let partialPaymentIdx = null;

print('\n--- D) Payments — partial unique index status ---');
for (const idx of paymentIndexes) {
  if (idx.key.orderId !== undefined && idx.key.hotelId !== undefined && idx.partialFilterExpression) {
    partialPaymentIdx = idx;
    const pfxStr = JSON.stringify(idx.partialFilterExpression);
    const coversPending    = pfxStr.includes('pending');
    const coversProcessing = pfxStr.includes('processing');
    print('  {orderId,hotelId} partial unique : EXISTS');
    print('    partialFilterExpression        : ' + pfxStr);
    print('    Covers "pending"               : ' + coversPending);
    print('    Covers "processing"            : ' + coversProcessing);
    if (!coversPending || !coversProcessing) print('    WARNING: expression incomplete');
  }
}
if (!partialPaymentIdx) print('  {orderId,hotelId} partial unique : NOT PRESENT — must create before deploy');

print('\n  Full payments index list:');
for (const idx of paymentIndexes) {
  print('    ' + JSON.stringify(idx.key) + '  unique=' + !!idx.unique + '  partial=' + !!idx.partialFilterExpression + '  name=' + idx.name);
}

// ── E) Hotel records ─────────────────────────────────────────────────────
const hotelTotal     = db.hotels.countDocuments({});
const hotelActive    = db.hotels.countDocuments({ status: 'active' });
const hotelTrial     = db.hotels.countDocuments({ status: 'trial' });
const hotelSuspended = db.hotels.countDocuments({ status: 'suspended' });

print('\n--- E) Hotel documents ---');
print('  Total               : ' + hotelTotal);
print('  Active              : ' + hotelActive);
print('  Trial               : ' + hotelTrial);
print('  Suspended           : ' + hotelSuspended);
print('  Other               : ' + (hotelTotal - hotelActive - hotelTrial - hotelSuspended));

// ── E) Orphan check ──────────────────────────────────────────────────────
const auditOrphanArr = db.auditlogs.aggregate([
  { $match: { hotelId: { $type: 'string' } } },
  { $match: { $expr: { $regexMatch: { input: '$hotelId', regex: '^[0-9a-fA-F]{24}$' } } } },
  { $group: { _id: null, ids: { $addToSet: '$hotelId' } } },
  { $unwind: '$ids' },
  { $project: { _id: 0, hotelOid: { $toObjectId: '$ids' } } },
  { $lookup: { from: 'hotels', localField: 'hotelOid', foreignField: '_id', as: 'match' } },
  { $match: { match: { $size: 0 } } },
  { $count: 'orphans' },
]).toArray();
const auditOrphans = auditOrphanArr.length > 0 ? auditOrphanArr[0].orphans : 0;

const chatOrphanArr = db.chatmessages.aggregate([
  { $match: { hotelId: { $type: 'string' } } },
  { $match: { $expr: { $regexMatch: { input: '$hotelId', regex: '^[0-9a-fA-F]{24}$' } } } },
  { $group: { _id: null, ids: { $addToSet: '$hotelId' } } },
  { $unwind: '$ids' },
  { $project: { _id: 0, hotelOid: { $toObjectId: '$ids' } } },
  { $lookup: { from: 'hotels', localField: 'hotelOid', foreignField: '_id', as: 'match' } },
  { $match: { match: { $size: 0 } } },
  { $count: 'orphans' },
]).toArray();
const chatOrphans = chatOrphanArr.length > 0 ? chatOrphanArr[0].orphans : 0;

print('\n--- E) Orphan hotelId check (string records vs Hotel._id) ---');
print('  AuditLog orphaned hotelIds    : ' + auditOrphans + (auditOrphans > 0 ? '  <-- will become dangling refs after migration' : '  (none)'));
print('  ChatMessage orphaned hotelIds : ' + chatOrphans + (chatOrphans > 0 ? '  <-- will become dangling refs after migration' : '  (none)'));

// ── Summary ──────────────────────────────────────────────────────────────
const migrationNeeded  = (auditString > 0) || (chatString > 0);
const hasInvalid       = (auditInvalid > 0) || (chatInvalid > 0);
const hasOrphans       = (auditOrphans > 0) || (chatOrphans > 0);
const indexActionNeeded= hasOldOfflineId || !hasCompoundOfflineId || !partialPaymentIdx;

print('\n========================================');
print('PREFLIGHT REPORT');
print('========================================');
print('1. Migration required              : ' + (migrationNeeded ? 'YES' : 'NO'));
print('2. AuditLog records to migrate     : ' + auditString);
print('3. ChatMessage records to migrate  : ' + chatString);
print('4. Invalid hotelId records         : ' + (auditInvalid + chatInvalid) + (hasInvalid ? '  <-- BLOCKS migration' : '  (none)'));
print('5. OfflineId index status          : ' +
  (hasOldOfflineId ? 'OLD INDEX EXISTS (drop required)' : 'old index absent') + ' | ' +
  (hasCompoundOfflineId ? 'NEW INDEX EXISTS' : 'NEW INDEX MISSING (create required)'));
print('6. Payment index status            : ' +
  (partialPaymentIdx ? 'PRESENT AND CORRECT' : 'MISSING — create before deploy'));
print('7. Orphan hotelId records          : ' + (auditOrphans + chatOrphans) + (hasOrphans ? '  <-- review before migration' : '  (none)'));
print('8. Data integrity concern          : ' + ((hasInvalid || hasOrphans) ? 'YES — see items 4 and 7' : 'None detected'));

print('\n----------------------------------------');
if (hasInvalid) {
  print('PRE-DEPLOYMENT STATUS: BLOCKED');
  print('Reason: ' + (auditInvalid + chatInvalid) + ' invalid hotelId string(s) cannot be converted.');
  print('Investigate manually: db.auditlogs.find({ hotelId: { $type: "string" }, $expr: { $not: { $regexMatch: { input: "$hotelId", regex: "^[0-9a-fA-F]{24}$" } } } }).limit(5)');
} else {
  print('PRE-DEPLOYMENT STATUS: READY FOR MIGRATION');
  if (migrationNeeded)      print('  Action 1 : Run migrate-hotelid-to-objectid.js');
  if (hasOldOfflineId)      print('  Action 2 : db.orders.dropIndex("offlineId_1")');
  if (!hasCompoundOfflineId)print('  Action 3 : db.orders.createIndex({ hotelId:1, offlineId:1 }, { unique:true, sparse:true })');
  if (!partialPaymentIdx)   print('  Action 4 : db.payments.createIndex({ orderId:1, hotelId:1 }, { unique:true, partialFilterExpression:{ status:{ $in:["pending","processing"] } } })');
  if (!migrationNeeded && !indexActionNeeded) print('  No actions required — schema and indexes are up to date.');
}
print('----------------------------------------');
