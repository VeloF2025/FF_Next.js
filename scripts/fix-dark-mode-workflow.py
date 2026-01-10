#!/usr/bin/env python3
"""
Fix dark mode styling in workflow module by converting hardcoded colors to CSS variables.
"""

import os
import re
from pathlib import Path

# Files already fixed manually
SKIP_FILES = {
    'WorkflowPortalPage.tsx',
    'WorkflowTabs.tsx',
    'TemplateList.tsx',
    'WorkflowEditor.tsx'
}

# Color mappings
REPLACEMENTS = [
    # Backgrounds
    (r'bg-white(?![a-zA-Z0-9/-])', 'bg-[var(--ff-bg-secondary)]'),
    (r'bg-gray-50(?![a-zA-Z0-9/-])', 'bg-[var(--ff-bg-tertiary)]'),
    (r'bg-gray-100(?![a-zA-Z0-9/-])', 'bg-[var(--ff-bg-tertiary)]'),

    # Text colors
    (r'text-gray-900(?![a-zA-Z0-9/-])', 'text-[var(--ff-text-primary)]'),
    (r'text-gray-800(?![a-zA-Z0-9/-])', 'text-[var(--ff-text-primary)]'),
    (r'text-gray-700(?![a-zA-Z0-9/-])', 'text-[var(--ff-text-primary)]'),
    (r'text-gray-600(?![a-zA-Z0-9/-])', 'text-[var(--ff-text-secondary)]'),
    (r'text-gray-500(?![a-zA-Z0-9/-])', 'text-[var(--ff-text-secondary)]'),
    (r'text-gray-400(?![a-zA-Z0-9/-])', 'text-[var(--ff-text-tertiary)]'),

    # Borders
    (r'border-gray-200(?![a-zA-Z0-9/-])', 'border-[var(--ff-border-light)]'),
    (r'border-gray-300(?![a-zA-Z0-9/-])', 'border-[var(--ff-border-light)]'),

    # Hover states
    (r'hover:bg-gray-50(?![a-zA-Z0-9/-])', 'hover:bg-[var(--ff-bg-hover)]'),
    (r'hover:text-gray-900(?![a-zA-Z0-9/-])', 'hover:text-[var(--ff-text-primary)]'),
    (r'hover:text-gray-700(?![a-zA-Z0-9/-])', 'hover:text-[var(--ff-text-primary)]'),
    (r'hover:text-gray-600(?![a-zA-Z0-9/-])', 'hover:text-[var(--ff-text-secondary)]'),

    # Status badge conversions
    (r'bg-green-100 text-green-800', 'bg-green-500/20 text-green-400'),
    (r'bg-yellow-100 text-yellow-800', 'bg-yellow-500/20 text-yellow-400'),
    (r'bg-red-100 text-red-800', 'bg-red-500/20 text-red-400'),
    (r'bg-blue-100 text-blue-800', 'bg-blue-500/20 text-blue-400'),
    (r'bg-purple-100 text-purple-800', 'bg-purple-500/20 text-purple-400'),
    (r'bg-orange-100 text-orange-800', 'bg-orange-500/20 text-orange-400'),
    (r'bg-cyan-100 text-cyan-800', 'bg-cyan-500/20 text-cyan-400'),
    (r'bg-indigo-100 text-indigo-800', 'bg-indigo-500/20 text-indigo-400'),
]

# Additional dark mode class removals (since we're using CSS variables)
DARK_MODE_REMOVALS = [
    (r' dark:bg-gray-900', ''),
    (r' dark:bg-gray-800', ''),
    (r' dark:bg-gray-700', ''),
    (r' dark:bg-gray-600', ''),
    (r' dark:text-gray-100', ''),
    (r' dark:text-gray-200', ''),
    (r' dark:text-gray-300', ''),
    (r' dark:text-gray-400', ''),
    (r' dark:text-gray-500', ''),
    (r' dark:border-gray-700', ''),
    (r' dark:border-gray-600', ''),
    (r' dark:border-gray-800', ''),
    (r' dark:hover:bg-gray-700', ''),
    (r' dark:hover:bg-gray-800', ''),
    (r' dark:hover:text-gray-300', ''),
    (r' dark:hover:text-gray-200', ''),

    # Dark status badge removals
    (r' dark:bg-green-900/20 dark:text-green-300', ''),
    (r' dark:bg-yellow-900/20 dark:text-yellow-300', ''),
    (r' dark:bg-red-900/20 dark:text-red-300', ''),
    (r' dark:bg-blue-900/20 dark:text-blue-300', ''),
    (r' dark:bg-purple-900/20 dark:text-purple-300', ''),
    (r' dark:bg-orange-900/20 dark:text-orange-300', ''),
    (r' dark:bg-cyan-900/20 dark:text-cyan-300', ''),
    (r' dark:bg-indigo-900/20 dark:text-indigo-300', ''),
    (r' dark:bg-gray-700 dark:text-gray-300', ''),
]


def fix_file(file_path: Path) -> bool:
    """Fix dark mode colors in a single file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        original_content = content

        # Apply replacements
        for pattern, replacement in REPLACEMENTS:
            content = re.sub(pattern, replacement, content)

        # Remove dark mode classes
        for pattern, replacement in DARK_MODE_REMOVALS:
            content = re.sub(pattern, replacement, content)

        # Only write if content changed
        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True

        return False

    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return False


def main():
    """Process all workflow module tsx files."""
    workflow_dir = Path('src/modules/workflow')

    if not workflow_dir.exists():
        print(f"Error: {workflow_dir} does not exist")
        return

    # Find all .tsx files (excluding tests)
    tsx_files = [
        f for f in workflow_dir.rglob('*.tsx')
        if '__tests__' not in str(f) and f.name not in SKIP_FILES
    ]

    print(f"Found {len(tsx_files)} files to process")

    fixed_count = 0
    for file_path in tsx_files:
        if fix_file(file_path):
            print(f"✓ Fixed: {file_path.relative_to(workflow_dir)}")
            fixed_count += 1
        else:
            print(f"  Skipped (no changes): {file_path.relative_to(workflow_dir)}")

    print(f"\n✅ Complete! Fixed {fixed_count} out of {len(tsx_files)} files")


if __name__ == '__main__':
    main()
