#!/bin/bash
# Rate Limiting Test Script for FibreFlow
# Tests different endpoint categories with their respective rate limits

echo "================================"
echo "FibreFlow Rate Limiting Test"
echo "================================"
echo ""

BASE_URL="http://localhost:3000"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Testing Rate Limits..."
echo ""

# Test 1: General endpoint (100 req/min)
echo -e "${YELLOW}Test 1: General API endpoint (100 req/min limit)${NC}"
echo "Making 105 requests to /api/analytics/web-vitals/summary..."
SUCCESS=0
BLOCKED=0
for i in {1..105}; do
    RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/analytics/web-vitals/summary" 2>/dev/null)
    STATUS_CODE=$(echo "$RESPONSE" | tail -1)
    
    if [ "$STATUS_CODE" = "429" ]; then
        BLOCKED=$((BLOCKED + 1))
    elif [ "$STATUS_CODE" = "200" ] || [ "$STATUS_CODE" = "404" ]; then
        SUCCESS=$((SUCCESS + 1))
    fi
    
    # Show progress every 10 requests
    if [ $((i % 10)) -eq 0 ]; then
        echo "  Progress: $i/105 (Success: $SUCCESS, Blocked: $BLOCKED)"
    fi
done

echo ""
if [ $BLOCKED -gt 0 ]; then
    echo -e "${GREEN}✓ PASS:${NC} Rate limiting working! $BLOCKED requests blocked after limit."
else
    echo -e "${RED}✗ FAIL:${NC} No requests blocked. Rate limiting may not be active."
fi
echo ""

# Test 2: Auth endpoint (10 req/min)
echo -e "${YELLOW}Test 2: Auth endpoint (10 req/min limit)${NC}"
echo "Making 15 requests to /api/auth/login..."
SUCCESS=0
BLOCKED=0
for i in {1..15}; do
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d '{"email":"test@test.com","password":"test"}' \
        "$BASE_URL/api/auth/login" 2>/dev/null)
    STATUS_CODE=$(echo "$RESPONSE" | tail -1)
    
    if [ "$STATUS_CODE" = "429" ]; then
        BLOCKED=$((BLOCKED + 1))
    elif [ "$STATUS_CODE" != "" ]; then
        SUCCESS=$((SUCCESS + 1))
    fi
    
    echo "  Request $i: HTTP $STATUS_CODE"
done

echo ""
if [ $BLOCKED -gt 0 ]; then
    echo -e "${GREEN}✓ PASS:${NC} Auth rate limiting working! $BLOCKED requests blocked."
else
    echo -e "${RED}✗ FAIL:${NC} No auth requests blocked. Rate limiting may not be active."
fi
echo ""

# Test 3: Write operation endpoint (30 req/min)
echo -e "${YELLOW}Test 3: Write operation (30 req/min limit)${NC}"
echo "Making 35 POST requests to a write endpoint..."
SUCCESS=0
BLOCKED=0
for i in {1..35}; do
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        "$BASE_URL/api/projects" 2>/dev/null)
    STATUS_CODE=$(echo "$RESPONSE" | tail -1)
    
    if [ "$STATUS_CODE" = "429" ]; then
        BLOCKED=$((BLOCKED + 1))
    elif [ "$STATUS_CODE" != "" ]; then
        SUCCESS=$((SUCCESS + 1))
    fi
    
    # Show progress every 5 requests
    if [ $((i % 5)) -eq 0 ]; then
        echo "  Progress: $i/35 (Success: $SUCCESS, Blocked: $BLOCKED)"
    fi
done

echo ""
if [ $BLOCKED -gt 0 ]; then
    echo -e "${GREEN}✓ PASS:${NC} Write operation rate limiting working! $BLOCKED requests blocked."
else
    echo -e "${RED}✗ FAIL:${NC} No write requests blocked. Rate limiting may not be active."
fi
echo ""

echo "================================"
echo "Test Summary"
echo "================================"
echo ""
echo "IMPORTANT: If all tests show 'FAIL', the ARCJET_KEY is likely not configured."
echo "Arcjet is designed to gracefully degrade without the API key."
echo ""
echo "To enable rate limiting:"
echo "1. Sign up at https://arcjet.com (free tier available)"
echo "2. Create a site/project and copy the API key"
echo "3. Add to /home/velo/fibreflow-production/.env.local:"
echo "   ARCJET_KEY=ajkey_your_key_here"
echo "4. Restart: sudo systemctl restart fibreflow-production"
echo "5. Re-run this test script"
echo ""
