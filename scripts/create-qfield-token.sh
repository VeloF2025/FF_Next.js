#!/bin/bash

# QFieldCloud Token Creation Script
# For OES sync to OES_Project_Progress

echo "============================================"
echo "QFieldCloud Token Creation for OES Sync"
echo "============================================"
echo ""

# Check if we have admin credentials
ADMIN_USER="admin"
ADMIN_PASS="QField@2026"  # Standard password we'll set

echo "1. First, let's try to access QFieldCloud admin..."
echo ""

# Try to login with admin credentials
echo "Testing login to QFieldCloud..."
LOGIN_RESPONSE=$(curl -s -X POST https://qfield.fibreflow.app/api/v1/auth/login/ \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"$ADMIN_USER\", \"password\": \"$ADMIN_PASS\"}" \
  --insecure)

if echo "$LOGIN_RESPONSE" | grep -q "token"; then
    echo "✅ Login successful!"
    AUTH_TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])")
    echo "Auth token obtained: ${AUTH_TOKEN:0:20}..."
else
    echo "❌ Login failed. Admin credentials might not exist."
    echo ""
    echo "Please create admin account manually:"
    echo "1. Go to https://qfield.fibreflow.app/admin/"
    echo "2. Or ask someone with admin access to create a token"
    echo ""
    echo "Alternatively, we can try to create admin via Django shell..."
    exit 1
fi

echo ""
echo "2. Creating API token for OES sync..."

# Create API token
TOKEN_RESPONSE=$(curl -s -X POST https://qfield.fibreflow.app/api/v1/auth/tokens/ \
  -H "Authorization: Token $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "OES_Sync_Token_2026", "expires_at": null}' \
  --insecure)

if echo "$TOKEN_RESPONSE" | grep -q "token"; then
    API_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])")
    echo "✅ API token created successfully!"
    echo ""
    echo "============================================"
    echo "API TOKEN FOR OES SYNC:"
    echo "$API_TOKEN"
    echo "============================================"
    echo ""
    echo "Save this token! It won't be shown again."

    # Save to file
    echo "$API_TOKEN" > /tmp/qfield_oes_token.txt
    echo "Token saved to: /tmp/qfield_oes_token.txt"

else
    echo "❌ Failed to create token"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi

echo ""
echo "3. Next steps:"
echo "   - Update scripts with this token"
echo "   - Run sync to upload OES data"
echo "   - Verify data in QFieldCloud project"