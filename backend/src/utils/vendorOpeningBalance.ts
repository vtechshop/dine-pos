// Phase 5 · Batch 6 (P4-INV-06): one way to set a vendor's opening balance — what the hotel owed
// the vendor before using DinePOS. Moved unchanged from POST /vendor-ledger/:vendorId/opening-balance
// so that creating or editing a vendor in the Vendors page uses it too (the form's Opening Balance
// was silently discarded). Must run inside the caller's transaction.
import mongoose from 'mongoose';
import Vendor from '../models/Vendor';
import VendorLedgerEntry from '../models/VendorLedgerEntry';

export async function setVendorOpeningBalance(
  hotelId: mongoose.Types.ObjectId,
  vendorId: string,
  amt: number,
  notes: string | undefined,
  session: mongoose.ClientSession,
): Promise<{ oldBalance: number; currentOutstanding: number }> {
  // Read the vendor INSIDE the transaction so MongoDB's snapshot detects concurrent writes and
  // retries — preventing double-increment races.
  const vendor = await Vendor.findOne(
    { _id: vendorId, hotelId, isDeleted: false },
    'openingBalance currentOutstanding',
    { session },
  );
  if (!vendor) throw new Error('Vendor not found');

  const oldBalance = vendor.openingBalance;
  const diff = amt - oldBalance;

  const existing = await VendorLedgerEntry.findOne({
    hotelId, vendorId: new mongoose.Types.ObjectId(vendorId), entryType: 'opening_balance',
  }).session(session);

  if (existing) {
    existing.debit          = amt;
    existing.runningBalance = amt;
    existing.description    = String(notes || 'Opening balance');
    await existing.save({ session });
  } else {
    await VendorLedgerEntry.create([{
      hotelId,
      vendorId,
      entryType:       'opening_balance',
      referenceId:     null,
      referenceNumber: '',
      debit:           amt,
      credit:          0,
      runningBalance:  amt,
      description:     String(notes || 'Opening balance'),
    }], { session });
  }

  const updated = await Vendor.findOneAndUpdate(
    { _id: vendorId, hotelId },
    { $set: { openingBalance: amt }, $inc: { currentOutstanding: diff } },
    { new: true, session },
  );
  return { oldBalance, currentOutstanding: updated?.currentOutstanding ?? (vendor.currentOutstanding + diff) };
}

/** A usable opening balance from a form value: a number ≥ 0, to the paisa; otherwise an error message. */
export function parseOpeningBalance(v: unknown): { amount: number } | { error: string } {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n)) return { error: 'Opening balance must be a number' };
  if (n < 0) return { error: 'Opening balance (what you owe the vendor) cannot be negative' };
  return { amount: Math.round(n * 100) / 100 };
}
