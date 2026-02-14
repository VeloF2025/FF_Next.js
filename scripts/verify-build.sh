#!/bin/bash
# Build verification script for FibreFlow
# Checks build integrity before deployment

BUILD_DIR=/home/velo/fibreflow-production/.next
EXIT_CODE=0

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

check() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $2"
        return 0
    else
        echo -e "${RED}✗${NC} $2 (missing: $1)"
        EXIT_CODE=1
        return 1
    fi
}

echo "=== FibreFlow Build Verification ==="
echo "Build directory: $BUILD_DIR"
echo ""

# Critical files
check "$BUILD_DIR/BUILD_ID" "BUILD_ID"
check "$BUILD_DIR/build-manifest.json" "Build Manifest"
check "$BUILD_DIR/prerender-manifest.json" "Prerender Manifest"
check "$BUILD_DIR/routes-manifest.json" "Routes Manifest"
check "$BUILD_DIR/required-server-files.json" "Required Server Files"
check "$BUILD_DIR/package.json" "Package Info"

# Directories
if [ -d "$BUILD_DIR/server" ]; then
    echo -e "${GREEN}✓${NC} Server directory"
else
    echo -e "${RED}✗${NC} Server directory missing"
    EXIT_CODE=1
fi

if [ -d "$BUILD_DIR/static" ]; then
    echo -e "${GREEN}✓${NC} Static directory"
else
    echo -e "${RED}✗${NC} Static directory missing"
    EXIT_CODE=1
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ Build is valid${NC}"
else
    echo -e "${RED}❌ Build is INVALID${NC}"
fi

exit $EXIT_CODE
