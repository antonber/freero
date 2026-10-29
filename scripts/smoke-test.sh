#!/usr/bin/env sh
# Smoke test of a running Freero deployment (a container in CI, the compose stack, staging):
# readiness, the SPA, signup, board creation, an image upload served back, and /metrics.
#
#   scripts/smoke-test.sh http://localhost:4000 [metrics-token]
#
# Needs curl. Exits non-zero on the first failure.
set -eu

BASE="${1:?usage: smoke-test.sh <base-url> [metrics-token]}"
BASE="${BASE%/}"
TOKEN="${2:-${METRICS_TOKEN:-}}"
JAR="$(mktemp)"
BODY="$(mktemp)"
PNG="$(mktemp)"
trap 'rm -f "$JAR" "$BODY" "$PNG"' EXIT

fail() {
  echo "smoke: FAIL $*" >&2
  [ -s "$BODY" ] && { echo "--- response:" >&2; head -c 2000 "$BODY" >&2; echo >&2; }
  exit 1
}
# req METHOD PATH [curl args...] -> prints the status code, body in $BODY
req() {
  method="$1"
  path="$2"
  shift 2
  curl -sS -o "$BODY" -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" -H "Origin: $BASE" "$@" "$BASE$path"
}

echo "smoke: waiting for $BASE/readyz"
i=0
until [ "$(curl -s -o "$BODY" -w '%{http_code}' "$BASE/readyz" || true)" = 200 ]; do
  i=$((i + 1))
  [ "$i" -ge 90 ] && fail "readyz never became ready"
  sleep 1
done
echo "smoke: ready $(cat "$BODY")"

[ "$(req GET /healthz)" = 200 ] || fail "healthz"
[ "$(req GET /app)" = 200 ] && grep -q '<div id="root">' "$BODY" || fail "the web app is not served at /app"
# `/` is the marketing site (modules/site), or a redirect to /app when it is off (SITE=false / no build).
root="$(req GET /)"
[ "$root" = 200 ] || [ "$root" = 302 ] || fail "/ -> $root"

email="smoke-$(date +%s)-$$@example.com"
status="$(req POST /api/auth/signup -H 'Content-Type: application/json' \
  --data "{\"name\":\"Smoke Test\",\"email\":\"$email\",\"password\":\"smoke-password-123\"}")"
[ "$status" = 201 ] || fail "signup -> $status"
echo "smoke: signed up $email"

status="$(req POST /api/boards -H 'Content-Type: application/json' --data '{"title":"Smoke board"}')"
[ "$status" = 201 ] || fail "create board -> $status"
board="$(sed -n 's/.*"board":{"id":"\([^"]*\)".*/\1/p' "$BODY")"
[ -n "$board" ] || fail "no board id in the response"
[ "$(req GET "/api/boards/$board")" = 200 ] || fail "get board"
echo "smoke: created board $board"

# A 1x1 PNG, uploaded and read back byte for byte.
printf '\211PNG\r\n\032\n\000\000\000\rIHDR\000\000\000\001\000\000\000\001\010\006\000\000\000\037\025\304\211\000\000\000\rIDATx\332c\370\017\000\001\001\001\000\030\335\215\260\000\000\000\000IEND\256B`\202' > "$PNG"
status="$(req POST /api/uploads -H 'Content-Type: image/png' --data-binary "@$PNG")"
[ "$status" = 201 ] || fail "upload -> $status"
url="$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' "$BODY")"
status="$(curl -sS -L -o "$BODY" -w '%{http_code}' "$BASE$url")"
[ "$status" = 200 ] && cmp -s "$BODY" "$PNG" || fail "uploaded image not served back intact ($url -> $status)"
echo "smoke: uploaded and served $url"

status="$(req POST /api/boards -H 'Content-Type: application/json' -H 'Origin: https://evil.example' --data '{}')"
[ "$status" = 403 ] || fail "cross-site POST was not refused ($status)"

if [ -n "$TOKEN" ]; then
  status="$(curl -sS -o "$BODY" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE/metrics")"
  [ "$status" = 200 ] && grep -q '^freero_http_request_duration_seconds_count' "$BODY" || fail "metrics -> $status"
  echo "smoke: metrics ok"
fi

# Leave nothing behind on a real deployment: the throwaway account (and with it its board and
# upload) goes through the normal self-service deletion.
status="$(req POST /api/auth/account/delete -H 'Content-Type: application/json' --data '{"password":"smoke-password-123"}')"
[ "$status" = 200 ] || fail "deleting the smoke account -> $status"
echo "smoke: deleted the smoke account"

echo "smoke: PASS"
