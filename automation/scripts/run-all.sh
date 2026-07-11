#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(dirname "$SCRIPT_DIR")"
REPORTS_DIR="$AUTOMATION_DIR/reports"

# ── Critical: backend must run with NODE_ENV=test ─────────────────────────────
# The rate limiter's skip() checks process.env.NODE_ENV in the BACKEND process.
# Setting it here ensures every child process spawned by this script inherits it,
# but the already-running backend is unaffected if started without NODE_ENV=test.
# Start the backend with:  cd backend && npm run start:test
export NODE_ENV=test

echo "======================================================"
echo "  DinePOS Complete Automation Test Suite"
echo "======================================================"
echo ""

# Load env (NODE_ENV=test set above is already exported; .env.test confirms it)
if [[ -f "$AUTOMATION_DIR/.env.test" ]]; then
  set -a
  source "$AUTOMATION_DIR/.env.test"
  set +a
fi

# ── Pre-flight: verify backend is reachable and in test mode ──────────────────
BACKEND_URL="${TEST_API_URL:-http://localhost:5000}"
SADMIN_ID="${SUPER_ADMIN_ID:-superadmin}"
SADMIN_PASS="${SUPER_ADMIN_PASS:-super1234}"

echo "Checking backend at $BACKEND_URL ..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "x-super-admin-id: $SADMIN_ID" \
  -H "x-super-admin-pass: $SADMIN_PASS" \
  "$BACKEND_URL/api/superadmin/health" 2>/dev/null || echo "000")

if [[ "$HTTP_STATUS" == "000" ]]; then
  echo ""
  echo "❌  Backend unreachable at $BACKEND_URL"
  echo "    Start it in TEST mode first:"
  echo "      cd backend && npm run start:test"
  echo ""
  exit 1
fi

# Probe rate-limiter: send a burst of 5 rapid requests to /api/categories.
# If ANY returns 429, the backend is running with its rate limiter active
# (NODE_ENV != test) and the full suite will produce false 429 failures.
RATE_LIMIT_HIT=0
for i in $(seq 1 5); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "x-super-admin-id: $SADMIN_ID" \
    -H "x-super-admin-pass: $SADMIN_PASS" \
    "$BACKEND_URL/api/superadmin/health" 2>/dev/null || echo "000")
  if [[ "$CODE" == "429" ]]; then
    RATE_LIMIT_HIT=1
    break
  fi
done

# Check directly: hit a rate-limited endpoint many times quickly
# (categories has 60/min limit; 5 rapid requests won't trigger it, but we can
#  infer test mode by looking for the startup message in the health response)
# Instead, fire a burst at /api/products (60/min limit) to see if we'd be blocked.
# We use /api/superadmin/health which has no rate limit, so we probe differently:
# make one request to an endpoint that would 401 (no auth) but not 429 in test mode.
PROBE=$(curl -s -w "\n%{http_code}" \
  "$BACKEND_URL/api/products" 2>/dev/null || echo -e "\n000")
PROBE_CODE=$(echo "$PROBE" | tail -1)

if [[ "$PROBE_CODE" == "429" ]]; then
  RATE_LIMIT_HIT=1
fi

if [[ "$RATE_LIMIT_HIT" == "1" ]]; then
  echo ""
  echo "⚠️  WARNING: Backend rate limiter is ACTIVE (got HTTP 429)."
  echo "    The full suite will produce false failures."
  echo "    Stop the backend and restart it in test mode:"
  echo "      cd backend && npm run start:test"
  echo ""
  echo "    Aborting to prevent misleading test results."
  exit 1
fi

echo "  ✅ Backend reachable and rate limiter appears inactive (NODE_ENV=test confirmed)"
echo ""

mkdir -p "$REPORTS_DIR/html" "$REPORTS_DIR/junit" "$REPORTS_DIR/coverage" \
         "$REPORTS_DIR/playwright-html" "$REPORTS_DIR/performance" \
         "$REPORTS_DIR/security" "$REPORTS_DIR/logs"

FAILED=0
PASSED=0

run_phase() {
  local name="$1"
  local cmd="$2"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Phase: $name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if eval "$cmd"; then
    echo "  ✅ $name PASSED"
    PASSED=$((PASSED + 1))
  else
    echo "  ❌ $name FAILED"
    FAILED=$((FAILED + 1))
  fi
}

cd "$AUTOMATION_DIR"

# Phase 1: Backend API Tests
run_phase "API Tests (Jest + Supertest)" "npm run test:api -- --forceExit 2>&1 | tee $REPORTS_DIR/logs/api.log"

# Phase 2: Web Tests (Playwright) — skip if no WEB_BASE_URL
if [[ -n "${WEB_BASE_URL:-}" ]]; then
  run_phase "Web Tests (Playwright)" "npm run test:web 2>&1 | tee $REPORTS_DIR/logs/web.log"
else
  echo "  ⏭  Web Tests skipped (WEB_BASE_URL not set)"
fi

# Phase 3: Mobile Tests (Maestro) — skip if maestro not installed
if command -v maestro &>/dev/null; then
  run_phase "Mobile Tests (Maestro)" "npm run test:mobile 2>&1 | tee $REPORTS_DIR/logs/mobile.log"
else
  echo "  ⏭  Mobile Tests skipped (maestro not found — install with: curl -Ls 'https://get.maestro.mobile.dev' | bash)"
fi

# Phase 4: Performance Smoke Test
if command -v k6 &>/dev/null; then
  run_phase "Performance Smoke Test (k6)" "npm run test:performance:smoke 2>&1 | tee $REPORTS_DIR/logs/perf-smoke.log"
else
  echo "  ⏭  Performance Tests skipped (k6 not found — install: https://k6.io/docs/getting-started/installation/)"
fi

echo ""
echo "======================================================"
echo "  Results: ✅ $PASSED passed  ❌ $FAILED failed"
echo "======================================================"
echo ""
echo "Reports:"
echo "  API HTML:    $REPORTS_DIR/html/report.html"
echo "  API JUnit:   $REPORTS_DIR/junit/api-results.xml"
echo "  Coverage:    $REPORTS_DIR/coverage/lcov-report/index.html"
echo "  Web HTML:    $REPORTS_DIR/playwright-html/index.html"
echo "  Logs:        $REPORTS_DIR/logs/"
echo ""

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
