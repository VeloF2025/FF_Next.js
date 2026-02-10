#!/usr/bin/env python3
"""
Migrates API routes from individual Pool instances to shared pool.
Replaces:
  import { Pool } from 'pg';
  const pool = new Pool({...});
With:
  import pool from '@/lib/db';
"""

import os
import re
from pathlib import Path

def migrate_file(filepath):
    """Migrate a single file to use shared pool"""
    with open(filepath, 'r') as f:
        content = f.read()

    original_content = content

    # Pattern 1: Remove Pool import from pg
    # Match: import { Pool } from 'pg'; or import pg from 'pg'; const { Pool } = pg;
    content = re.sub(r"import\s+{\s*Pool\s*}\s+from\s+['\"]pg['\"];\s*\n", "", content)
    content = re.sub(r"import\s+pg\s+from\s+['\"]pg['\"];\s*\nconst\s+{\s*Pool\s*}\s*=\s*pg;\s*\n", "", content)

    # Pattern 2: Remove pool instantiation (handles multi-line)
    pool_pattern = r"const\s+pool\s*=\s*new\s+Pool\s*\(\s*{[^}]*}\s*\);\s*\n+"
    content = re.sub(pool_pattern, "", content, flags=re.DOTALL)

    # Pattern 3: Add pool import (find good location after other imports)
    # Look for last import statement
    import_pattern = r"(import\s+[^;]+;)\s*\n\n"
    matches = list(re.finditer(import_pattern, content))

    if matches and "import pool from '@/lib/db';" not in content:
        last_import = matches[-1]
        insert_pos = last_import.end()
        content = content[:insert_pos] + "import pool from '@/lib/db';\n" + content[insert_pos:]

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def main():
    pages_api = Path('pages/api')

    # Find all TypeScript files with pool instantiation
    migrated = 0
    for ts_file in pages_api.rglob('*.ts'):
        try:
            with open(ts_file, 'r') as f:
                if 'const pool = new Pool(' in f.read():
                    if migrate_file(ts_file):
                        print(f"✓ {ts_file}")
                        migrated += 1
        except Exception as e:
            print(f"✗ {ts_file}: {e}")

    print(f"\nMigrated {migrated} files")

if __name__ == '__main__':
    main()
