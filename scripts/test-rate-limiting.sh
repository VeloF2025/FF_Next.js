#!/bin/bash
# Rate Limiting Test Script
# Tests all rate limit tiers to verify Arcjet is working

echo "========================================"
echo "Rate Limiting Test Script"
echo "========================================"
echo ""

BASE_URL="http://localhost:3000"
FAILED=0
PASSED=0

# Colors
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[1;33m"
NC="\033[0m" # No Color

echo "Testing against: $BASE_URL"
echo ""

# Test 1: General Endpoints (100 req/min)
echo "----------------------------------------"
echo "Test 1: General Endpoints (100 req/min)"
echo "----------------------------------------"
echo "Sending 105 GET requests to /api/monitoring/health..."

SUCCESS=0
BLOCKED=0

for i in {1..105}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/monitoring/health")
  if [ "$HTTP_CODE" == "200" ]; then
    SUCCESS=$((SUCCESS + 1))
  elif [ "$HTTP_CODE" == "429" ]; then
    BLOCKED=$((BLOCKED + 1))
  fi
  
  # Show progress every 20 requests
  if [ $((i % 20)) -eq 0 ]; then
    echo "  Progress: $i/105 requests sent..."
  fi
done

echo ""
echo "Results:"
echo "  ✓ Successful (200): $SUCCESS"
echo "  ✗ Rate Limited (429): $BLOCKED"

if [ $BLOCKED -ge 5 ]; then
  echo -e "  ${GREEN}PASS${NC} - Rate limiting is working!"
  PASSED=$((PASSED + 1))
else
  echo -e "  ${RED}FAIL${NC} - Rate limiting may not be active (expected ~5 blocks, got $BLOCKED)"
  FAILED=$((FAILED + 1))
fi

echo ""
sleep 5 # Wait for rate limit window to reset

# Test 2: Auth Endpoints (10 req/min)
echo "----------------------------------------"
echo "Test 2: Auth Endpoints (10 req/min)"
echo "----------------------------------------"
echo "Sending 15 POST requests to /api/auth/login..."

SUCCESS=0
BLOCKED=0

for i in {1..15}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d password:test)
  
  if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "400" ] || [ "$HTTP_CODE" == "401" ]; then
    SUCCESS=$((SUCCESS + 1))
  elif [ "$HTTP_CODE" == "429" ]; then
    BLOCKED=$((BLOCKED + 1))
  fi
  
  if [ $((i % 5)) -eq 0 ]; then
    echo "  Progress: $i/15 requests sent..."
  fi
done

echo ""
echo "Results:"
echo "  ✓ Successful (200/400/401): $SUCCESS"
echo "  ✗ Rate Limited (429): $BLOCKED"

if [ $BLOCKED -ge 5 ]; then
  echo -e "  ${GREEN}PASS${NC} - Auth rate limiting is working!"
  PASSED=$((PASSED + 1))
else
  echo -e "  ${RED}FAIL${NC} - Auth rate limiting may not be active (expected ~5 blocks, got $BLOCKED)"
  FAILED=$((FAILED + 1))
fi

echo ""
sleep 5 # Wait for rate limit window to reset

# Test 3: Write Operations (30 req/min)
echo "----------------------------------------"
echo "Test 3: Write Operations (30 req/min)"
echo "----------------------------------------"
echo "Sending 35 POST requests to a general API endpoint..."

SUCCESS=0
BLOCKED=0

# Using a generic endpoint that should exist but will likely fail auth
# We are testing rate limiting, not functionality
for i in {1..35}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/projects" \
    -H "Content-Type: application/json" \
    -d {test:data})
  
  if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "400" ] || [ "$HTTP_CODE" == "401" ] || [ "$HTTP_CODE" == "403" ]; then
    SUCCESS=$((SUCCESS + 1))
  elif [ "$HTTP_CODE" == "429" ]; then
    BLOCKED=$((BLOCKED + 1))
  fi
  
  if [ $((i % 10)) -eq 0 ]; then
    echo "  Progress: $i/35 requests sent..."
  fi
done

echo ""
echo "Results:"
echo "  ✓ Successful (200/400/401/403): $SUCCESS"
echo "  ✗ Rate Limited (429): $BLOCKED"

if [ $BLOCKED -ge 5 ]; then
  echo -e "  ${GREEN}PASS${NC} - Write operation rate limiting is working!"
  PASSED=$((PASSED + 1))
else
  echo -e "  ${RED}FAIL${NC} - Write rate limiting may not be active (expected ~5 blocks, got $BLOCKED)"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$PASSED${NC}/3"
echo -e "Failed: ${RED}$FAILED${NC}/3"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed! Rate limiting is working correctly.${NC}"
  exit 0
elif [ $PASSED -eq 0 ]; then
  echo -e "${RED}✗ All tests failed. ARCJET_KEY may not be configured.${NC}"
  echo ""
  echo "Check:"
  echo "  1. Is ARCJET_KEY set in .env.local?"
  echo "     grep ARCJET_KEY /home/velo/fibreflow-production/.env.local"
  echo ""
  echo "  2. Check logs for Arcjet warnings:"
  echo "     journalctl -u fibreflow-production --since \"5 min ago\" | grep -i arcjet"
  echo ""
  echo "  3. See activation guide:"
  echo "     cat /home/velo/ARCJET_ACTIVATION_STEPS.md"
  exit 1
else
  echo -e "${YELLOW}⚠ Some tests failed. Rate limiting may be partially configured.${NC}"
  exit 1
fi
