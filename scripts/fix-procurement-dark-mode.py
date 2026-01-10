#!/usr/bin/env python3
"""
Fix all dark mode issues in procurement module by converting hardcoded colors to CSS variables
"""

import re
from pathlib import Path

# Define the procurement directory
PROC_DIR = Path("/home/hein/Workspace/FF_Next.js/src/modules/procurement")

# Color replacement mapping
REPLACEMENTS = [
    # Background colors
    (r'\bbg-white\b', 'bg-[var(--ff-bg-secondary)]'),
    (r'\bbg-gray-50\b', 'bg-[var(--ff-bg-tertiary)]'),
    (r'\bbg-gray-100\b', 'bg-[var(--ff-bg-tertiary)]'),

    # Text colors
    (r'\btext-gray-900\b', 'text-[var(--ff-text-primary)]'),
    (r'\btext-gray-800\b', 'text-[var(--ff-text-primary)]'),
    (r'\btext-gray-700\b', 'text-[var(--ff-text-secondary)]'),
    (r'\btext-gray-600\b', 'text-[var(--ff-text-secondary)]'),
    (r'\btext-gray-500\b', 'text-[var(--ff-text-secondary)]'),
    (r'\btext-gray-400\b', 'text-[var(--ff-text-tertiary)]'),

    # Border colors
    (r'\bborder-gray-200\b', 'border-[var(--ff-border-light)]'),
    (r'\bborder-gray-300\b', 'border-[var(--ff-border-light)]'),

    # Hover states
    (r'\bhover:bg-gray-50\b', 'hover:bg-[var(--ff-bg-hover)]'),
    (r'\bhover:bg-gray-100\b', 'hover:bg-[var(--ff-bg-hover)]'),
    (r'\bhover:bg-gray-200\b', 'hover:bg-[var(--ff-bg-hover)]'),

    # Status badge backgrounds (convert to semi-transparent)
    (r'\bbg-blue-100\b', 'bg-blue-500/20'),
    (r'\bbg-blue-50\b', 'bg-blue-500/20'),
    (r'\bbg-green-100\b', 'bg-green-500/20'),
    (r'\bbg-green-50\b', 'bg-green-500/20'),
    (r'\bbg-yellow-100\b', 'bg-yellow-500/20'),
    (r'\bbg-yellow-50\b', 'bg-yellow-500/20'),
    (r'\bbg-red-100\b', 'bg-red-500/20'),
    (r'\bbg-red-50\b', 'bg-red-500/20'),
    (r'\bbg-purple-100\b', 'bg-purple-500/20'),
    (r'\bbg-purple-50\b', 'bg-purple-500/20'),
    (r'\bbg-orange-100\b', 'bg-orange-500/20'),
    (r'\bbg-orange-50\b', 'bg-orange-500/20'),
    (r'\bbg-indigo-100\b', 'bg-indigo-500/20'),
    (r'\bbg-indigo-50\b', 'bg-indigo-500/20'),

    # Status badge text colors
    (r'\btext-blue-800\b', 'text-blue-400'),
    (r'\btext-blue-700\b', 'text-blue-300'),
    (r'\btext-green-800\b', 'text-green-400'),
    (r'\btext-green-700\b', 'text-green-300'),
    (r'\btext-yellow-800\b', 'text-yellow-400'),
    (r'\btext-yellow-700\b', 'text-yellow-300'),
    (r'\btext-red-800\b', 'text-red-400'),
    (r'\btext-red-700\b', 'text-red-300'),
    (r'\btext-purple-800\b', 'text-purple-400'),
    (r'\btext-purple-700\b', 'text-purple-300'),
    (r'\btext-orange-800\b', 'text-orange-400'),
    (r'\btext-orange-700\b', 'text-orange-300'),
    (r'\btext-indigo-800\b', 'text-indigo-400'),
    (r'\btext-indigo-700\b', 'text-indigo-300'),

    # Border status colors
    (r'\bborder-blue-200\b', 'border-blue-500/30'),
    (r'\bborder-green-200\b', 'border-green-500/30'),
    (r'\bborder-yellow-200\b', 'border-yellow-500/30'),
    (r'\bborder-red-200\b', 'border-red-500/30'),
    (r'\bborder-purple-200\b', 'border-purple-500/30'),
    (r'\bborder-orange-200\b', 'border-orange-500/30'),
]

def fix_file(file_path: Path):
    """Apply all color replacements to a file"""
    try:
        content = file_path.read_text()
        original_content = content

        # Apply all replacements
        for pattern, replacement in REPLACEMENTS:
            content = re.sub(pattern, replacement, content)

        # Only write if something changed
        if content != original_content:
            file_path.write_text(content)
            return True
        return False
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return False

def main():
    """Process all TSX files in procurement module"""
    tsx_files = list(PROC_DIR.rglob("*.tsx"))
    fixed_count = 0

    print(f"Found {len(tsx_files)} TSX files in {PROC_DIR}")
    print("Fixing dark mode colors...\n")

    for file_path in tsx_files:
        if fix_file(file_path):
            print(f"✅ Fixed: {file_path.relative_to(PROC_DIR)}")
            fixed_count += 1
        else:
            print(f"⏭️  Skipped: {file_path.relative_to(PROC_DIR)} (no changes needed)")

    print(f"\n✅ Done! Fixed {fixed_count} out of {len(tsx_files)} files.")

if __name__ == "__main__":
    main()
