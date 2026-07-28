// ─── Vendor Matcher ───────────────────────────────────────────────────────────
// Fuzzy-matches extracted vendor name + GST against existing Vendor records.
// Pure Node.js — no external fuzzy-match library.
// Returns up to 3 ranked matches with confidence scores.
// Never auto-creates vendors; never writes to DB.

import mongoose from 'mongoose';
import Vendor from '../models/Vendor';
import { IVendorMatch } from '../models/OcrJob';

// ─── Jaro-Winkler string similarity ──────────────────────────────────────────

function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchDist = Math.max(Math.floor(Math.max(s1.length, s2.length) / 2) - 1, 0);
  const s1m = new Array(s1.length).fill(false);
  const s2m = new Array(s2.length).fill(false);
  let matches = 0;

  for (let i = 0; i < s1.length; i++) {
    const lo = Math.max(0, i - matchDist);
    const hi = Math.min(i + matchDist + 1, s2.length);
    for (let j = lo; j < hi; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = true;
      s2m[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let t = 0, k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1m[i]) continue;
    while (!s2m[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }

  return (matches / s1.length + matches / s2.length + (matches - t / 2) / matches) / 3;
}

function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|corp|co)\b\.?/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGST(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ─── Confidence computation ───────────────────────────────────────────────────
// GST match is the strongest signal — exact match → 1.0.
// Name similarity: Jaro-Winkler on normalized strings → 0.4–0.9.

function computeConfidence(
  vendorBusinessName: string,
  vendorGST:          string,
  extractedName:      string,
  extractedGST:       string,
): number {
  const cleanVGST = normalizeGST(vendorGST);
  const cleanEGST = normalizeGST(extractedGST);

  // Exact GST match → definitive
  if (cleanVGST && cleanEGST && cleanVGST === cleanEGST) return 1.0;

  // Partial GST match (first 10 chars)
  if (cleanVGST && cleanEGST && cleanVGST.length >= 10 && cleanEGST.length >= 10 &&
      cleanVGST.slice(0, 10) === cleanEGST.slice(0, 10)) {
    return 0.9;
  }

  const normVendor    = normalize(vendorBusinessName);
  const normExtracted = normalize(extractedName);

  if (!normVendor || !normExtracted) return 0;

  const jwScore = jaroWinkler(normVendor, normExtracted);

  // Boost if all words of the shorter name appear in the longer
  const words      = normExtracted.split(' ').filter((w) => w.length > 2);
  const matchedAll = words.length > 0 && words.every((w) => normVendor.includes(w));
  const wordBoost  = matchedAll ? 0.1 : 0;

  return Math.min(1.0, jwScore + wordBoost);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function matchVendors(
  hotelId:       string,
  extractedName: string,
  extractedGST:  string = '',
): Promise<IVendorMatch[]> {
  if (!extractedName.trim() && !extractedGST.trim()) return [];

  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const normGST   = normalizeGST(extractedGST);

  // ── Fast path: exact GST match (O(1) indexed lookup) ─────────────────────
  // A valid Indian GSTIN is 15 characters; skip if too short to be real.
  if (normGST.length >= 15) {
    const exactMatch = await Vendor.findOne(
      { hotelId: hotelOId, isDeleted: false, isActive: true, gstNumber: normGST },
      { businessName: 1, gstNumber: 1 },
    ).lean();

    if (exactMatch) {
      return [{
        vendorId:     exactMatch._id.toString(),
        businessName: (exactMatch as any).businessName,
        gstNumber:    (exactMatch as any).gstNumber ?? '',
        confidence:   1.000,
      }];
    }
  }

  // ── Fuzzy path: name similarity against up to 100 active vendors ──────────
  // Limit prevents loading an unbounded vendor catalog into application memory.
  const vendors = await Vendor.find(
    { hotelId: hotelOId, isDeleted: false, isActive: true },
    { businessName: 1, gstNumber: 1 },
  ).limit(100).lean();

  const scored = vendors
    .map((v) => ({
      vendorId:     v._id.toString(),
      businessName: (v as any).businessName,
      gstNumber:    (v as any).gstNumber ?? '',
      confidence:   computeConfidence((v as any).businessName, (v as any).gstNumber ?? '', extractedName, extractedGST),
    }))
    .filter((m) => m.confidence >= 0.4) // discard very weak matches
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((m) => ({ ...m, confidence: +m.confidence.toFixed(3) }));

  return scored;
}
