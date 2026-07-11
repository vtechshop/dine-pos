#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:5000}"
ADMIN_ID="${ADMIN_ID:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
REPORT_DIR="${REPORT_DIR:-$(pwd)/../../reports/security}"
ZAP_DOCKER_IMAGE="ghcr.io/zaproxy/zaproxy:stable"

if [[ -z "$ADMIN_ID" || -z "$ADMIN_PASSWORD" ]]; then
  echo "ERROR: ADMIN_ID and ADMIN_PASSWORD must be set"
  exit 1
fi

mkdir -p "$REPORT_DIR"

echo "[ZAP] Starting OWASP ZAP scan against $API_URL"

docker run --rm \
  --network host \
  -v "$(pwd)":/zap/wrk:ro \
  -v "$REPORT_DIR":/zap/reports:rw \
  -e API_URL="$API_URL" \
  -e ADMIN_ID="$ADMIN_ID" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e REPORT_DIR="/zap/reports" \
  "$ZAP_DOCKER_IMAGE" \
  zap.sh -cmd \
    -autorun /zap/wrk/zap-config.yaml

echo "[ZAP] Scan complete. Report at: $REPORT_DIR/zap-report.html"
