#!/usr/bin/env python3
"""
Batch fix dark mode in remaining components
Converts hardcoded Tailwind colors to CSS variables
"""

import re
from pathlib import Path

# Files to process (excluding already fixed ones)
FILES = [
    "src/components/settings/ServiceTemplatesTab.tsx",
    "src/components/settings/VFLogoUpload.tsx",
    "src/components/onemap/ImportWizard.tsx",
    "src/components/onemap/ImportAssistant.tsx",
    "src/components/forms/UniversalField.tsx",
    "src/components/forms/FieldSection.tsx",
    "src/components/error/DatabaseErrorBoundary.tsx",
    "src/components/dev/FirebaseTest.tsx",
    "src/components/dev/ProjectsDebug.tsx",
    "src/components/dev/StaffDebug.tsx",
    "src/components/dev/ClientsDebug.tsx",
    "src/components/demo/FileImportDemo.tsx",
    "src/components/ui/ChartErrorBoundary.tsx",
    "src/components/ui/DynamicChart.tsx",
    "src/components/ui/GlassCard.tsx",
    "src/components/ui/StandardActionButtons.tsx",
    "src/components/ui/VelocityButton.tsx",
    "src/components/ui/VirtualizedList.tsx",
    "src/components/database/DatabaseHealthIndicator.tsx",
    "src/components/search/GlobalSearch.tsx",
    "src/components/FibreFlowDashboard.tsx",
    "src/components/VersionChecker.tsx",
    "src/components/ErrorBoundary.tsx",
    "src/components/dashboard/EnhancedStatCard.tsx",
    "src/components/realtime/ConnectionStatus.tsx",
]

# Replacement patterns
REPLACEMENTS = [
    # Background colors
    (r'\bbg-white(?!\w)', 'bg-[var(--ff-bg-secondary)]'),
    (r'\bbg-gray-50(?!\d)', 'bg-[var(--ff-bg-tertiary)]'),
    (r'\bbg-gray-100(?!\d)', 'bg-[var(--ff-bg-tertiary)]'),

    # Text colors
    (r'\btext-gray-900(?!\d)', 'text-[var(--ff-text-primary)]'),
    (r'\btext-gray-800(?!\d)', 'text-[var(--ff-text-primary)]'),
    (r'\btext-gray-700(?!\d)', 'text-[var(--ff-text-primary)]'),
    (r'\btext-gray-600(?!\d)', 'text-[var(--ff-text-secondary)]'),
    (r'\btext-gray-500(?!\d)', 'text-[var(--ff-text-secondary)]'),
    (r'\btext-gray-400(?!\d)', 'text-[var(--ff-text-tertiary)]'),
    (r'\btext-gray-300(?!\d)', 'text-[var(--ff-text-tertiary)]'),

    # Border colors
    (r'\bborder-gray-200(?!\d)', 'border-[var(--ff-border-light)]'),
    (r'\bborder-gray-300(?!\d)', 'border-[var(--ff-border-light)]'),

    # Hover backgrounds
    (r'\bhover:bg-gray-50(?!\d)', 'hover:bg-[var(--ff-bg-hover)]'),
    (r'\bhover:bg-gray-100(?!\d)', 'hover:bg-[var(--ff-bg-hover)]'),
    (r'\bhover:bg-gray-200(?!\d)', 'hover:bg-[var(--ff-bg-hover)]'),

    # Remove dark: variants (they're replaced by CSS variables)
    (r' dark:bg-gray-\d+', ''),
    (r' dark:text-gray-\d+', ''),
    (r' dark:border-gray-\d+', ''),
    (r' dark:hover:bg-gray-\d+', ''),

    # Status badges: bg-{color}-100 text-{color}-800 -> bg-{color}-500/20 text-{color}-400
    (r'\bbg-red-100 text-red-800\b', 'bg-red-500/20 text-red-400'),
    (r'\bbg-red-50 text-red-700\b', 'bg-red-500/20 text-red-400'),
    (r'\bbg-green-100 text-green-800\b', 'bg-green-500/20 text-green-400'),
    (r'\bbg-green-50 text-green-700\b', 'bg-green-500/20 text-green-400'),
    (r'\bbg-blue-100 text-blue-800\b', 'bg-blue-500/20 text-blue-400'),
    (r'\bbg-blue-50 text-blue-700\b', 'bg-blue-500/20 text-blue-400'),
    (r'\bbg-yellow-100 text-yellow-800\b', 'bg-yellow-500/20 text-yellow-400'),
    (r'\bbg-amber-100 text-amber-800\b', 'bg-amber-500/20 text-amber-400'),

    # Hover backgrounds on colored elements
    (r'\bhover:bg-red-50(?!\d)', 'hover:bg-red-500/20'),
    (r'\bhover:bg-green-50(?!\d)', 'hover:bg-green-500/20'),
    (r'\bhover:bg-blue-50(?!\d)', 'hover:bg-blue-500/20'),
    (r'\bhover:bg-yellow-50(?!\d)', 'hover:bg-yellow-500/20'),
]

def fix_file(filepath: Path) -> bool:
    """Fix dark mode in a single file"""
    try:
        content = filepath.read_text()
        original = content

        # Apply all replacements
        for pattern, replacement in REPLACEMENTS:
            content = re.sub(pattern, replacement, content)

        # Only write if changes were made
        if content != original:
            filepath.write_text(content)
            print(f"✓ Fixed: {filepath}")
            return True
        else:
            print(f"  No changes: {filepath}")
            return False
    except Exception as e:
        print(f"✗ Error processing {filepath}: {e}")
        return False

def main():
    """Process all files"""
    print("Fixing dark mode in components...\n")

    fixed_count = 0
    error_count = 0

    for file_path_str in FILES:
        filepath = Path(file_path_str)
        if not filepath.exists():
            print(f"  File not found: {filepath}")
            error_count += 1
            continue

        if fix_file(filepath):
            fixed_count += 1

    print(f"\n✓ Fixed: {fixed_count} files")
    if error_count:
        print(f"✗ Errors: {error_count} files")

if __name__ == "__main__":
    main()
