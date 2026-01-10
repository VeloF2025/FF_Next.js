#!/bin/bash

# Comprehensive Dark Mode CSS Variable Conversion Script
# Converts hardcoded Tailwind colors to CSS variables across all module files

set -e  # Exit on error

echo "🎨 Starting comprehensive dark mode conversion for module files..."
echo ""

# List of module directories to process
MODULES=(
    "src/modules/sow"
    "src/modules/reports"
    "src/modules/nokia-equipment"
    "src/modules/onemap"
    "src/modules/installations/HomeInstallationsDashboard"
    "src/modules/kpi-dashboard"
    "src/modules/kpis"
    "src/modules/daily-progress"
    "src/modules/dashboard"
    "src/modules/admin"
    "src/modules/communications"
    "src/modules/field-app/components"
    "src/modules/contractor-documents-report/components"
    "src/modules/action-items"
)

# Count total files
total_files=0
for module in "${MODULES[@]}"; do
    if [ -d "$module" ]; then
        count=$(find "$module" -name "*.tsx" -type f 2>/dev/null | wc -l)
        total_files=$((total_files + count))
    fi
done

echo "📁 Found $total_files .tsx files to process"
echo ""

processed=0

# Process each module
for module in "${MODULES[@]}"; do
    if [ ! -d "$module" ]; then
        echo "⚠️  Skipping $module (not found)"
        continue
    fi

    echo "📂 Processing module: $module"

    find "$module" -name "*.tsx" -type f | while read -r file; do
        processed=$((processed + 1))
        echo "  [$processed/$total_files] $(basename "$file")"

        # Create backup
        cp "$file" "$file.backup"

        # Apply transformations using perl for better regex support
        perl -i -pe '
            # Background colors
            s/\bbg-white\b/bg-[var(--ff-bg-secondary)]/g;
            s/\bbg-gray-50\b/bg-[var(--ff-bg-tertiary)]/g;
            s/\bbg-gray-100\b/bg-[var(--ff-bg-tertiary)]/g;

            # Text colors
            s/\btext-gray-900\b/text-[var(--ff-text-primary)]/g;
            s/\btext-gray-800\b/text-[var(--ff-text-primary)]/g;
            s/\btext-gray-700\b/text-[var(--ff-text-primary)]/g;
            s/\btext-gray-600\b/text-[var(--ff-text-secondary)]/g;
            s/\btext-gray-500\b/text-[var(--ff-text-secondary)]/g;
            s/\btext-gray-400\b/text-[var(--ff-text-tertiary)]/g;

            # Border colors
            s/\bborder-gray-200\b/border-[var(--ff-border-light)]/g;
            s/\bborder-gray-300\b/border-[var(--ff-border-light)]/g;

            # Divide colors
            s/\bdivide-gray-200\b/divide-[var(--ff-border-light)]/g;

            # Hover states
            s/\bhover:bg-gray-50\b/hover:bg-[var(--ff-bg-hover)]/g;
            s/\bhover:bg-gray-100\b/hover:bg-[var(--ff-bg-hover)]/g;
            s/\bhover:bg-gray-200\b/hover:bg-[var(--ff-bg-hover)]/g;
            s/\bhover:text-gray-700\b/hover:text-[var(--ff-text-primary)]/g;
            s/\bhover:text-gray-600\b/hover:text-[var(--ff-text-secondary)]/g;
            s/\bhover:border-gray-300\b/hover:border-[var(--ff-border-light)]/g;

            # Status badges - combined patterns first
            s/\bbg-green-100 text-green-800\b/bg-green-500\/20 text-green-400/g;
            s/\bbg-red-100 text-red-800\b/bg-red-500\/20 text-red-400/g;
            s/\bbg-blue-100 text-blue-800\b/bg-blue-500\/20 text-blue-400/g;
            s/\bbg-yellow-100 text-yellow-800\b/bg-yellow-500\/20 text-yellow-400/g;
            s/\bbg-amber-100 text-amber-800\b/bg-amber-500\/20 text-amber-400/g;
            s/\bbg-purple-100 text-purple-800\b/bg-purple-500\/20 text-purple-400/g;
            s/\bbg-indigo-100 text-indigo-800\b/bg-indigo-500\/20 text-indigo-400/g;
            s/\bbg-orange-100 text-orange-800\b/bg-orange-500\/20 text-orange-400/g;

            # Individual status badge colors
            s/\bbg-green-100\b/bg-green-500\/20/g;
            s/\btext-green-800\b/text-green-400/g;
            s/\btext-green-700\b/text-green-400/g;

            s/\bbg-red-100\b/bg-red-500\/20/g;
            s/\btext-red-800\b/text-red-400/g;
            s/\btext-red-700\b/text-red-400/g;

            s/\bbg-blue-100\b/bg-blue-500\/20/g;
            s/\btext-blue-800\b/text-blue-400/g;
            s/\btext-blue-700\b/text-blue-400/g;

            s/\bbg-yellow-100\b/bg-yellow-500\/20/g;
            s/\btext-yellow-800\b/text-yellow-400/g;
            s/\btext-yellow-700\b/text-yellow-400/g;

            s/\bbg-amber-100\b/bg-amber-500\/20/g;
            s/\btext-amber-800\b/text-amber-400/g;
            s/\btext-amber-700\b/text-amber-400/g;

            s/\bbg-purple-100\b/bg-purple-500\/20/g;
            s/\btext-purple-800\b/text-purple-400/g;
            s/\btext-purple-700\b/text-purple-400/g;

            s/\bbg-indigo-100\b/bg-indigo-500\/20/g;
            s/\btext-indigo-800\b/text-indigo-400/g;
            s/\btext-indigo-700\b/text-indigo-400/g;

            s/\bbg-orange-100\b/bg-orange-500\/20/g;
            s/\btext-orange-800\b/text-orange-400/g;
            s/\btext-orange-700\b/text-orange-400/g;

            # Border colors for colored components
            s/\bborder-green-200\b/border-green-500\/30/g;
            s/\bborder-red-200\b/border-red-500\/30/g;
            s/\bborder-blue-200\b/border-blue-500\/30/g;
            s/\bborder-yellow-200\b/border-yellow-500\/30/g;
            s/\bborder-amber-200\b/border-amber-500\/30/g;
            s/\bborder-purple-200\b/border-purple-500\/30/g;
            s/\bborder-orange-200\b/border-orange-500\/30/g;

            # Background colors for colored areas (like bg-red-50 for error backgrounds)
            s/\bbg-red-50\b/bg-red-500\/20/g;
            s/\bbg-green-50\b/bg-green-500\/20/g;
            s/\bbg-blue-50\b/bg-blue-500\/20/g;
            s/\bbg-yellow-50\b/bg-yellow-500\/20/g;
            s/\bbg-amber-50\b/bg-amber-500\/20/g;
            s/\bbg-purple-50\b/bg-purple-500\/20/g;
            s/\bbg-orange-50\b/bg-orange-500\/20/g;
        ' "$file"

        # Remove backup if transformation was successful
        rm "$file.backup"
    done
done

echo ""
echo "✅ Dark mode conversion complete!"
echo "📊 Processed $total_files files"
echo ""
echo "Next steps:"
echo "1. Review changes: git diff src/modules/"
echo "2. Test the application in both light and dark modes"
echo "3. Commit changes: git add . && git commit -m 'fix: convert module colors to CSS variables for dark mode'"
