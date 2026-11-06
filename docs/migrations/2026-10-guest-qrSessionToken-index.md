# Guest `qrSessionToken` unique index — superseded

This note has been replaced by the full runbook:
**[2026-10-index-migration-runbook.md](2026-10-index-migration-runbook.md)** (section 5A).

Summary: create `qrSessionToken_unique_string` (partial, string tokens only) BEFORE
dropping the old `qrSessionToken_1`, and never drop the old index automatically.
