# ADR-001 — Hotel Code + User ID Identity Migration

**Status:** Approved  
**Date:** 2026-07-17  
**Replaces:** Legacy `adminId`-only login  

---

## Context

The current authentication model uses a single `adminId` field on the `Hotel`
document to serve as both the hotel's public identity and the owner's login
credential. This conflates two distinct concerns and makes it impossible to
add multiple named users (managers, owners) per hotel in the future.

Staff login (cashier / waiter / kitchen) is already on the correct model —
`hotelId + employeeCode + PIN`. Only the admin / owner / manager tier is being
migrated.

---

## Decision

Introduce a separate **Hotel Code** business identifier and a **User ID** per
staff member, layered additively on top of the existing schema. The legacy
`adminId` login path is never removed during this migration.

---

## Hotel Code — Identity Rules

Hotel Code is a **standalone business identifier** for the hotel. It is
**not derived from, and has no relationship to, the legacy `adminId` field.**

| Property | Rule |
|---|---|
| Format | `^[A-Z0-9]{4,8}$` — uppercase alphanumeric only |
| Length | 4–8 characters |
| Uniqueness | Unique across all hotels; enforced by a database unique index |
| Assignment | Set by Super Admin at approval time |
| Auto-suggestion | System suggests a value from the hotel name (see algorithm below) |
| Editability | Super Admin may edit the suggestion before confirming approval |
| Immutability | Once approved and activated, Hotel Code must not be changed |

**Examples:** `MALU`, `SPICE`, `VTECH`, `HOTEL01`, `DIN001`

### Suggestion Algorithm

Applies at approval time in the Super Admin UI. Not executed automatically:

```
1. Take hotel name, uppercase, strip everything except A–Z and 0–9
2. Take first 6 characters of the result
3. If result is < 4 chars, pad with sequential digits (e.g., "AB" → "AB01")
4. Check uniqueness against existing Hotel Codes
5. If taken, increment a trailing numeric suffix until unique (MALU → MALU1 → MALU2 …)
6. Present the suggestion to Super Admin as an editable field — they may override freely
```

The suggestion is a starting point. Super Admin always has final authority.

---

## Target Identity Model

```
Hotel Code   →  identifies the hotel               (e.g., MALU)
User ID      →  identifies the person within it    (e.g., owner, mgr_deep)

Login:  Hotel Code + User ID + Password
```

| Role | Hotel Code | User ID | Auth method |
|---|---|---|---|
| Owner | `MALU` | `owner` | password |
| Manager | `MALU` | `mgr_deep` | password |
| Cashier | `MALU` | `C001` | PIN — already on this model |
| Waiter | `MALU` | `W003` | PIN — already on this model |
| Kitchen | `MALU` | _(shared PIN)_ | PIN — already on this model |

---

## Database Changes (additive only)

### Hotel document — two new fields, nothing removed

```typescript
hotelCode: {
  type:    String,
  default: '',
  index:   true,
  unique:  true,   // sparse — only enforced on non-empty values
  match:   /^[A-Z0-9]{4,8}$/,
}
// adminId, adminPasswordHash — UNTOUCHED, kept for backward compat forever
```

### New collection — `hotelusers`

```typescript
{
  hotelId:      ObjectId    // ref Hotel._id
  hotelCode:    String      // denormalized; indexed for fast lookup
  userId:       String      // 'owner' | 'manager' | custom (min 3 chars)
  role:         'owner' | 'manager'
  passwordHash: String      // bcrypt, same cost as current adminPasswordHash
  name:         String
  isActive:     Boolean     // default true
  createdAt:    Date
}

// Compound unique — no two users share the same userId within a hotel
index: { hotelCode: 1, userId: 1 }, unique: true
```

---

## Backend Endpoints

### Legacy — unchanged forever

```
POST /api/auth/login
body: { adminId, password }
→ Hotel.findOne({ adminId })
→ same JWT, same response shape
```

### New — added alongside

```
POST /api/auth/login/v2
body: { hotelCode, userId, password }
→ Hotel.findOne({ hotelCode })
→ HotelUser.findOne({ hotelCode, userId })
→ bcrypt.compare(password, user.passwordHash)
→ generateToken(hotel._id, hotel.hotelName)   // identical call
→ same JWT, same response shape
```

**JWT structure, RBAC middleware, RefreshToken rotation — all unchanged.**

---

## Migration Data Seed (existing hotels)

For existing hotels, Hotel Code **cannot be auto-derived from `adminId`**.
Super Admin must explicitly assign a Hotel Code to each existing hotel.

**Seed process:**

```
For each existing hotel (status: trial | active):

  Step A — Super Admin assigns hotelCode
    • UI surfaces each hotel without a hotelCode
    • System auto-suggests using the algorithm above
    • Super Admin reviews and confirms or edits
    • No hotel is activated on the new login path until hotelCode is set

  Step B — Write Hotel.hotelCode
    • Persisted only after Super Admin confirmation
    • Unique index prevents duplicate assignments

  Step C — Create HotelUser seed record
    {
      hotelId:      hotel._id,
      hotelCode:    hotel.hotelCode,
      userId:       'owner',
      role:         'owner',
      passwordHash: hotel.adminPasswordHash,  // copied — owner password unchanged
      name:         hotel.ownerName,
      isActive:     true
    }
    • Owner's existing password works on /login/v2 immediately — no reset required
```

Existing hotels that have not yet been assigned a Hotel Code continue to use
the legacy `/api/auth/login` path without disruption.

---

## Rollout Phases

| Phase | Scope | Deploy target | Breaking? |
|---|---|---|---|
| 0 | Freeze Hotel Code format, finalize regex | None | No |
| 1 | Add `hotelCode` to Hotel schema; create `HotelUser` model | Backend only | No |
| 2 | `POST /api/auth/login/v2` live; SuperAdmin assigns codes and seeds HotelUsers for existing hotels | Backend only | No |
| 3 | Login form updated to Hotel Code + User ID; legacy toggle for unmigrated hotels | Web + Mobile | No |
| 4 | SuperAdmin tooling: add/remove HotelUsers per hotel; hotel owner can add managers | Backend + Mobile | No |
| 5 _(future)_ | Deprecate `/api/auth/login`; remove `adminId` references from UI | TBD | No |

Phase 5 is deferred indefinitely. Legacy path remains live until explicitly
scheduled.

---

## What Does Not Change

| Component | Status |
|---|---|
| JWT payload `{ hotelId, hotelName, role }` | Unchanged |
| RBAC middleware (`requireAdmin`, `requireCashier`, etc.) | Unchanged |
| Cashier / Waiter / Kitchen login endpoints | Unchanged |
| `Hotel` document fields `adminId`, `adminPasswordHash` | Unchanged |
| `RefreshToken` model and rotation | Unchanged |
| Mobile app legacy login (production Render backend) | Continues to work |

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Super Admin assigns duplicate Hotel Code | Unique DB index rejects it; UI shows conflict error |
| Existing hotel owner reset before Super Admin assigns hotelCode | Legacy path still works; no urgency |
| Super Admin assigns a Hotel Code that later needs changing | Hotel Code is immutable post-activation; must go through support process |
| Hotel Code suggestion conflicts with reserved words | Maintain a blocklist (ADMIN, ROOT, TEST, etc.) in the suggestion validator |
| HotelUser seed fails mid-batch | Seed is idempotent — re-running skips hotels that already have a HotelUser for userId='owner' |

---

## Superseded Behaviour

> The earlier draft proposed deriving `hotelCode` from the legacy `adminId`
> (e.g., `hotelCode = adminId`). **This approach is rejected.** Hotel Code is a
> business identifier with its own lifecycle and must be explicitly assigned by
> a human. Automatic derivation from a technical credential field would leak
> internal naming conventions into the public-facing identity and would make
> Hotel Code semantically dependent on `adminId`, which is the opposite of the
> intended separation.
