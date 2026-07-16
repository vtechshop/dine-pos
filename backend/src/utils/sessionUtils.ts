/**
 * sessionUtils.ts — shared session auto-creation helpers (Architecture v1.1 Phase 5)
 *
 * findOrCreateOpenSession: used by QR, kiosk, and waiter order flows.
 *   Finds the existing open session for a table or atomically creates one.
 *   The partial unique index { hotelId, tableId } where status='open' is the
 *   concurrency guard — concurrent requests that both miss the findOne will race
 *   to insert; the loser gets code 11000 and falls back to a second findOne.
 *
 * findOrCreateDefaultGuest: used by waiter/kiosk flows that don't specify a guestId.
 *   Identifies staff-created guests by qrSessionToken === null (QR guests always
 *   have a token until billing). Returns the first active staff guest or creates one.
 */

import mongoose from 'mongoose';
import TableSession from '../models/TableSession';
import Table from '../models/Table';
import Settings from '../models/Settings';
import Guest from '../models/Guest';
import { guestLabel } from './guestLabel';

export interface OpenSessionResult {
  session: any;
  created: boolean;
}

export async function findOrCreateOpenSession(
  tableId: string,
  hotelId: string,
  openedBy: string,
): Promise<OpenSessionResult> {
  const hotelObjId = new mongoose.Types.ObjectId(hotelId);
  const tableObjId = new mongoose.Types.ObjectId(tableId);

  // Fast path — most calls hit an already-open session
  const existing = await TableSession.findOne({
    tableId: tableObjId,
    hotelId: hotelObjId,
    status: 'open',
  });
  if (existing) return { session: existing, created: false };

  const table = await Table.findOne({ _id: tableObjId, hotelId: hotelObjId });
  if (!table) throw Object.assign(new Error('Table not found'), { httpStatus: 404 });
  if (table.status === 'inactive') {
    throw Object.assign(new Error('Table is inactive'), { httpStatus: 409 });
  }

  const settings = await Settings.findOne({ hotelId: hotelObjId })
    .select('qrGuestTimeoutMinutes')
    .lean();
  const qrTimeoutMinutes: number = (settings as any)?.qrGuestTimeoutMinutes ?? 15;

  try {
    const session = await TableSession.create({
      hotelId:          hotelObjId,
      tableId:          tableObjId,
      tableNumber:      String(table.number),
      openedBy,
      qrTimeoutMinutes,
    });

    // Non-blocking: session is created; table status is informational
    Table.findByIdAndUpdate(tableId, {
      $set: { status: 'occupied', currentSessionId: session._id },
    }).catch(() => {});

    return { session, created: true };
  } catch (err: any) {
    if (err.code === 11000) {
      // Race: another concurrent request won the insert — find and return their session
      const winner = await TableSession.findOne({
        tableId: tableObjId,
        hotelId: hotelObjId,
        status: 'open',
      });
      if (winner) return { session: winner, created: false };
    }
    throw err;
  }
}

/**
 * Find or create the "table default" guest for staff-placed orders.
 * Identified by qrSessionToken === null (QR guests always carry a token until billed).
 * The session document is passed directly to avoid a redundant lookup for tableId/tableNumber.
 */
export async function findOrCreateDefaultGuest(session: any, hotelId: string): Promise<any> {
  const hotelObjId = new mongoose.Types.ObjectId(hotelId);

  const existing = await Guest.findOne({
    sessionId:      session._id,
    hotelId:        hotelObjId,
    status:         'active',
    qrSessionToken: null,
  }).sort({ guestNumber: 1 });

  if (existing) return existing;

  const count       = await Guest.countDocuments({ sessionId: session._id });
  const guestNumber = count + 1;

  return Guest.create({
    hotelId:     hotelObjId,
    sessionId:   session._id,
    tableId:     session.tableId,
    tableNumber: session.tableNumber,
    guestNumber,
    displayLabel: guestLabel(guestNumber),
    status:      'active',
    totalAmount: 0,
    // qrSessionToken omitted — null by default; marks this as a staff-created guest
  });
}
