#!/usr/bin/env bash
# Copies .env.test.example to .env.test and prompts to fill in required values
set -euo pipefail

AUTOMATION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="$AUTOMATION_DIR/.env.test.example"
TARGET="$AUTOMATION_DIR/.env.test"

if [[ -f "$TARGET" ]]; then
  echo ".env.test already exists. Delete it first to recreate."
  exit 0
fi

if [[ ! -f "$EXAMPLE" ]]; then
  echo "ERROR: .env.test.example not found"
  exit 1
fi

cp "$EXAMPLE" "$TARGET"
echo ""
echo "Created .env.test from .env.test.example"
echo ""
echo "REQUIRED — edit $TARGET and fill in:"
echo "  TEST_API_URL        — your backend URL (e.g. http://localhost:5000)"
echo "  SUPER_ADMIN_ID      — super admin identifier"
echo "  SUPER_ADMIN_PASS    — super admin password"
echo "  JWT_SECRET          — same secret used by your backend"
echo "  MONGODB_TEST_URI    — MongoDB connection string for test DB"
echo "  SOCKET_URL          — Socket.IO server URL"
echo ""
echo "OPTIONAL:"
echo "  WEB_BASE_URL        — web app URL for Playwright tests"
echo "  ZAP_API_KEY         — for OWASP ZAP security scan"
echo ""
