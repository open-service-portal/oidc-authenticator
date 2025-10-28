#!/bin/bash
#
# Try different callback URL formats to find which one Auth0 accepts
#

set -e

URLS=(
  "http://localhost:8000"
  "http://localhost:8000/"
  "http://127.0.0.1:8000"
  "http://127.0.0.1:8000/"
  "http://localhost:18000"
  "http://localhost:18000/"
  "http://127.0.0.1:18000"
  "http://127.0.0.1:18000/"
  "http://localhost:8000/callback"
  "http://127.0.0.1:8000/callback"
)

CLIENT_ID="mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa"
ORG_ID="org_zOuCBHiyF1yG8d1D"

echo "Testing which callback URL Auth0 accepts..."
echo

for URL in "${URLS[@]}"; do
  echo -n "Testing: $URL ... "

  # Build authorization URL
  ENCODED_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$URL', safe=''))")
  AUTH_URL="https://login.spot.rackspace.com/authorize?client_id=$CLIENT_ID&response_type=code&redirect_uri=$ENCODED_URL&scope=openid&state=test&organization=$ORG_ID"

  # Try to access it and check for "Callback URL mismatch"
  RESPONSE=$(curl -s "$AUTH_URL" 2>&1 | head -100)

  if echo "$RESPONSE" | grep -q "Callback URL mismatch"; then
    echo "❌ REJECTED"
  elif echo "$RESPONSE" | grep -q "error"; then
    echo "❌ ERROR"
  else
    echo "✅ ACCEPTED (or redirected to login)"
    echo "   This URL might work!"
  fi
done

echo
echo "If multiple URLs are accepted, try them in order of preference"
