#!/usr/bin/env python3
"""
Convert procurement module files to use CSS variables for dark mode support.
"""

import os
import re
from pathlib import Path

# Define replacement patterns
REPLACEMENTS = [
    # Background colors
    (r'\bbg-white\b', 'bg-[var(--ff-bg-secondary)]'),
    (r'\bbg-gray-50\b', 'bg-[var(--ff-bg-tertiary)]'),
    (r'\bbg-gray-100\b', 'bg-[var(--ff-bg-tertiary)]'),

    # Text colors
    (r'\btext-gray-900\b', 'text-[var(--ff-text-primary)]'),
    (r'\btext-gray-800\b', 'text-[var(--ff-text-primary)]'),
    (r'\btext-gray-700\b', 'text-[var(--ff-text-primary)]'),
    (r'\btext-gray-600\b', 'text-[var(--ff-text-secondary)]'),
    (r'\btext-gray-500\b', 'text-[var(--ff-text-secondary)]'),
    (r'\btext-gray-400\b', 'text-[var(--ff-text-tertiary)]'),

    # Border colors
    (r'\bborder-gray-200\b', 'border-[var(--ff-border-light)]'),
    (r'\bborder-gray-300\b', 'border-[var(--ff-border-light)]'),
    (r'\bdivide-gray-200\b', 'divide-[var(--ff-border-light)]'),

    # Hover states
    (r'\bhover:bg-gray-50\b', 'hover:bg-[var(--ff-bg-hover)]'),
    (r'\bhover:bg-gray-100\b', 'hover:bg-[var(--ff-bg-hover)]'),
    (r'\bhover:bg-gray-200\b', 'hover:bg-[var(--ff-bg-hover)]'),

    # Status badge patterns - two-class combos first (before individual classes)
    (r'\bbg-red-100 text-red-800\b', 'bg-red-500/20 text-red-400'),
    (r'\bbg-red-100 text-red-700\b', 'bg-red-500/20 text-red-400'),
    (r'\bbg-yellow-100 text-yellow-800\b', 'bg-yellow-500/20 text-yellow-400'),
    (r'\bbg-yellow-100 text-yellow-700\b', 'bg-yellow-500/20 text-yellow-400'),
    (r'\bbg-green-100 text-green-800\b', 'bg-green-500/20 text-green-400'),
    (r'\bbg-green-100 text-green-700\b', 'bg-green-500/20 text-green-400'),
    (r'\bbg-blue-100 text-blue-800\b', 'bg-blue-500/20 text-blue-400'),
    (r'\bbg-blue-100 text-blue-700\b', 'bg-blue-500/20 text-blue-400'),
    (r'\bbg-purple-100 text-purple-800\b', 'bg-purple-500/20 text-purple-400'),
    (r'\bbg-purple-100 text-purple-700\b', 'bg-purple-500/20 text-purple-400'),
    (r'\bbg-indigo-100 text-indigo-800\b', 'bg-indigo-500/20 text-indigo-400'),
    (r'\bbg-indigo-100 text-indigo-700\b', 'bg-indigo-500/20 text-indigo-400'),
    (r'\bbg-orange-100 text-orange-800\b', 'bg-orange-500/20 text-orange-400'),
    (r'\bbg-orange-100 text-orange-700\b', 'bg-orange-500/20 text-orange-400'),

    # Individual badge backgrounds (after combo patterns)
    (r'\bbg-red-100\b', 'bg-red-500/20'),
    (r'\bbg-yellow-100\b', 'bg-yellow-500/20'),
    (r'\bbg-green-100\b', 'bg-green-500/20'),
    (r'\bbg-blue-100\b', 'bg-blue-500/20'),
    (r'\bbg-purple-100\b', 'bg-purple-500/20'),
    (r'\bbg-indigo-100\b', 'bg-indigo-500/20'),
    (r'\bbg-orange-100\b', 'bg-orange-500/20'),

    # Badge text colors
    (r'\btext-red-800\b', 'text-red-400'),
    (r'\btext-red-700\b', 'text-red-400'),
    (r'\btext-yellow-800\b', 'text-yellow-400'),
    (r'\btext-yellow-700\b', 'text-yellow-400'),
    (r'\btext-green-800\b', 'text-green-400'),
    (r'\btext-green-700\b', 'text-green-400'),
    (r'\btext-blue-800\b', 'text-blue-400'),
    (r'\btext-blue-700\b', 'text-blue-400'),
    (r'\btext-purple-800\b', 'text-purple-400'),
    (r'\btext-purple-700\b', 'text-purple-400'),
    (r'\btext-indigo-800\b', 'text-indigo-400'),
    (r'\btext-indigo-700\b', 'text-indigo-400'),
    (r'\btext-orange-800\b', 'text-orange-400'),
    (r'\btext-orange-700\b', 'text-orange-400'),

    # Progress bars and misc backgrounds
    (r'\bbg-gray-200\b', 'bg-[var(--ff-bg-tertiary)]'),
]

def convert_file(file_path: Path) -> tuple[bool, int]:
    """
    Convert a single file. Returns (changed, replacement_count).
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        original_content = content
        replacement_count = 0

        # Apply all replacements
        for pattern, replacement in REPLACEMENTS:
            content, count = re.subn(pattern, replacement, content)
            replacement_count += count

        # Only write if changes were made
        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True, replacement_count

        return False, 0

    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return False, 0

def main():
    """Main conversion function."""
    procurement_dir = Path('src/modules/procurement')

    if not procurement_dir.exists():
        print(f"Error: Directory {procurement_dir} does not exist")
        return 1

    # Find all .tsx files
    tsx_files = list(procurement_dir.rglob('*.tsx'))

    print(f"Found {len(tsx_files)} .tsx files in procurement module")
    print("Converting to CSS variables...\n")

    total_files_changed = 0
    total_replacements = 0

    for file_path in tsx_files:
        changed, count = convert_file(file_path)
        if changed:
            total_files_changed += 1
            total_replacements += count
            print(f"✓ {file_path.relative_to('src/modules/procurement')}: {count} replacements")

    print(f"\n{'='*60}")
    print(f"Conversion complete!")
    print(f"Files changed: {total_files_changed}/{len(tsx_files)}")
    print(f"Total replacements: {total_replacements}")
    print(f"{'='*60}")

    return 0

if __name__ == '__main__':
    exit(main())
