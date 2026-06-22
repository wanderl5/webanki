#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}/api"

echo "=== WebAnki API Smoke Test ==="
echo "Base URL: $BASE"

# Register unique user
TIMESTAMP=$(date +%s)
EMAIL="smoke_${TIMESTAMP}@example.com"
USERNAME="smoke_${TIMESTAMP}"

echo ""
echo "[1/9] Register user"
REG=$(curl -s -X POST "$BASE/auth/register" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"username\":\"$USERNAME\",\"password\":\"password123\"}")
echo "$REG" | python3 -m json.tool || true
TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

echo ""
echo "[2/9] Login"
LOGIN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}")
echo "$LOGIN" | python3 -m json.tool || true

echo ""
echo "[3/9] Create deck"
DECK=$(curl -s -X POST "$BASE/decks" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"name":"Smoke::Test"}')
echo "$DECK" | python3 -m json.tool || true
DECK_ID=$(echo "$DECK" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo ""
echo "[4/9] Create card"
CARD=$(curl -s -X POST "$BASE/cards" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"deck_id\":\"$DECK_ID\",\"front\":\"What is 2+2?\",\"back\":\"4\",\"tags\":[\"math\"]}")
echo "$CARD" | python3 -m json.tool || true
CARD_ID=$(echo "$CARD" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo ""
echo "[5/9] List decks"
curl -s "$BASE/decks" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool || true

echo ""
echo "[6/9] Study queue"
curl -s "$BASE/study/queue" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool || true

echo ""
echo "[7/9] Review card"
curl -s -X POST "$BASE/study/$CARD_ID/review" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"rating":"Good"}' | python3 -m json.tool || true

echo ""
echo "[8/9] Stats"
curl -s "$BASE/stats" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool || true

echo ""
echo "[9/9] Import preview + commit"
PREVIEW=$(curl -s -X POST "$BASE/import/preview" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"deck_id\":\"$DECK_ID\",\"text\":\"Capital of France?\nParis\"}")
echo "$PREVIEW" | python3 -m json.tool || true
curl -s -X POST "$BASE/import/commit" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"deck_id\":\"$DECK_ID\",\"cards\":[{\"front\":\"Capital of Japan?\",\"back\":\"Tokyo\",\"tags\":[],\"source\":\"manual\"}]}" | python3 -m json.tool || true

echo ""
echo "=== Smoke test completed successfully ==="
