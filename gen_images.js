#!/usr/bin/env node
/**
 * gen_images.js — Auto-assign Pexels food photos to products that have no image
 *
 * Prerequisites:
 *   1. Free Pexels API key  →  https://www.pexels.com/api/  (instant, no credit card)
 *   2. Your admin userId + password
 *   3. Node.js 18+  (has built-in fetch)
 *
 * Usage:
 *   node gen_images.js
 *
 *   Or pass via env:
 *   ADMIN_USER=admin@hotel.com ADMIN_PASS=yourpass PEXELS_KEY=yourkey node gen_images.js
 */

// ── CONFIG — fill these in ──────────────────────────────────────────────────
const API_BASE   = process.env.API_BASE   || 'https://dine-pos.onrender.com/api';
const ADMIN_USER = process.env.ADMIN_USER || 'ledvtech@gmail.com'; // ← your admin userId
const ADMIN_PASS = process.env.ADMIN_PASS || 'YOUR_ADMIN_PASSWORD'; // ← your admin password
const PEXELS_KEY = process.env.PEXELS_KEY || 'YOUR_PEXELS_KEY';    // ← from pexels.com/api/
// ───────────────────────────────────────────────────────────────────────────

const DELAY_MS = 500; // ms between requests — respects Pexels rate limit

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch(endpoint, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return JSON.parse(text);
}

async function login() {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!data.token) throw new Error('Login succeeded but no token returned');
  return data.token;
}

async function getProducts(token) {
  const data = await apiFetch('/products', {}, token);
  return Array.isArray(data) ? data : (data.products || []);
}

async function patchProduct(token, id, imageUrl) {
  await apiFetch(`/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ image: imageUrl }),
  }, token);
}

// ── Image search ─────────────────────────────────────────────────────────────

async function findImage(productName) {
  // Try increasingly generic queries until we get a result
  const queries = [
    productName,
    `${productName} food`,
    `${productName} dish`,
    'indian food dish',
  ];

  for (const query of queries) {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=square`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Pexels ${res.status}: ${txt}`);
    }
    const data = await res.json();
    if (data.photos?.length > 0) {
      return data.photos[0].src.large2x || data.photos[0].src.large;
    }
    await sleep(DELAY_MS);
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Guard: config not filled in
  if (PEXELS_KEY === 'YOUR_PEXELS_KEY') {
    console.error('\n❌  Pexels API key missing.');
    console.error('   Get a free key (takes 2 minutes) at: https://www.pexels.com/api/');
    console.error('   Then set it at the top of gen_images.js  or run:');
    console.error('   PEXELS_KEY=xxxxx node gen_images.js\n');
    process.exit(1);
  }
  if (ADMIN_USER === 'YOUR_ADMIN_USERID') {
    console.error('\n❌  Admin credentials missing.');
    console.error('   Edit ADMIN_USER / ADMIN_PASS at the top of gen_images.js\n');
    process.exit(1);
  }

  console.log('🔐  Logging in...');
  let token;
  try {
    token = await login();
    console.log('✅  Logged in\n');
  } catch (err) {
    console.error(`❌  Login failed: ${err.message}`);
    process.exit(1);
  }

  console.log('📦  Fetching products...');
  const products = await getProducts(token);
  const missing  = products.filter(p => !p.image);
  const hasImage = products.length - missing.length;

  console.log(`    Total products : ${products.length}`);
  console.log(`    Already have image : ${hasImage}`);
  console.log(`    Need image : ${missing.length}\n`);

  if (missing.length === 0) {
    console.log('🎉  All products already have images!');
    return;
  }

  let ok = 0, skipped = 0, failed = 0;

  for (let i = 0; i < missing.length; i++) {
    const p = missing[i];
    const prefix = `[${String(i + 1).padStart(String(missing.length).length)}/${missing.length}]`;
    process.stdout.write(`${prefix} ${p.name.padEnd(30)} `);

    try {
      const imageUrl = await findImage(p.name);
      if (!imageUrl) {
        console.log('⚠️  no image found — skipped');
        skipped++;
        continue;
      }
      await patchProduct(token, p._id, imageUrl);
      console.log('✅');
      ok++;
    } catch (err) {
      console.log(`❌  ${err.message}`);
      failed++;
    }

    if (i < missing.length - 1) await sleep(DELAY_MS);
  }

  console.log('\n──────────────────────────────────');
  console.log(`✅  Updated  : ${ok}`);
  if (skipped) console.log(`⚠️  Skipped  : ${skipped}`);
  if (failed)  console.log(`❌  Failed   : ${failed}`);
  console.log('\n🎉  Done! Pull-to-refresh in the app to see the images.');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
