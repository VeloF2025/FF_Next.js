#!/bin/bash
# Migrate remaining API routes to use shared database pool
# This script:
# 1. Removes "import { Pool } from 'pg';" lines
# 2. Removes "const pool = new Pool({...});" blocks (up to 3 lines)
# 3. Adds "import pool from '@/lib/db';" after the last import

set -e

# Find all files that still have pool instantiation
files=$(grep -l "const pool = new Pool(" pages/api/**/*.ts 2>/dev/null || true)

if [ -z "$files" ]; then
  echo "No files to migrate"
  exit 0
fi

echo "Found $(echo "$files" | wc -l) files to migrate"

for file in $files; do
  echo "Processing: $file"

  # Create backup
  cp "$file" "$file.bak"

  # Step 1: Remove Pool import
  sed -i "/^import { Pool } from 'pg';$/d" "$file"
  sed -i "/^import pg from 'pg';$/d" "$file"
  sed -i "/^const { Pool } = pg;$/d" "$file"

  # Step 2: Remove pool instantiation (multi-line, up to 4 lines)
  # Pattern: const pool = new Pool({ ... });
  sed -i '/^const pool = new Pool({$/,/^});$/d' "$file"

  # Step 3: Find position to add import (after last import, before first non-import line)
  # Add import after the last import statement if not already present
  if ! grep -q "import pool from '@/lib/db';" "$file"; then
    # Find line number of last import
    last_import_line=$(grep -n "^import " "$file" | tail -1 | cut -d: -f1)

    if [ -n "$last_import_line" ]; then
      # Insert after last import
      sed -i "${last_import_line}a import pool from '@/lib/db';" "$file"
    fi
  fi

  echo "  ✓ Migrated"
done

echo ""
echo "Migration complete!"
echo "Backups created with .bak extension"
echo ""
echo "Verify the changes and run:"
echo "  npm run type-check"
echo "  npm run lint"
