#!/bin/bash

# Script to convert hardcoded Tailwind colors to CSS variables for dark mode
# This script applies systematic replacements across module files

echo "Starting dark mode CSS variable conversion for module files..."

# Function to apply replacements to a file
fix_file() {
    local file="$1"
    echo "Processing: $file"

    # Background colors
    sed -i 's/bg-white\([^-]\)/bg-[var(--ff-bg-secondary)]\1/g' "$file"
    sed -i 's/bg-gray-50\([^-]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"
    sed -i 's/bg-gray-100\([^-]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"

    # Text colors
    sed -i 's/text-gray-900\([^-]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-800\([^-]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-700\([^-]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-600\([^-]\)/text-[var(--ff-text-secondary)]\1/g' "$file"
    sed -i 's/text-gray-500\([^-]\)/text-[var(--ff-text-secondary)]\1/g' "$file"
    sed -i 's/text-gray-400\([^-]\)/text-[var(--ff-text-tertiary)]\1/g' "$file"

    # Border colors
    sed -i 's/border-gray-200\([^-]\)/border-[var(--ff-border-light)]\1/g' "$file"
    sed -i 's/border-gray-300\([^-]\)/border-[var(--ff-border-light)]\1/g' "$file"

    # Divide colors (for tables and lists)
    sed -i 's/divide-gray-200\([^-]\)/divide-[var(--ff-border-light)]\1/g' "$file"

    # Hover states
    sed -i 's/hover:bg-gray-50\([^-]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"
    sed -i 's/hover:bg-gray-100\([^-]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"
    sed -i 's/hover:bg-gray-200\([^-]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"

    # Status badge conversions - use opacity format for dark mode
    sed -i 's/bg-green-100 text-green-800/bg-green-500\/20 text-green-400/g' "$file"
    sed -i 's/bg-red-100 text-red-800/bg-red-500\/20 text-red-400/g' "$file"
    sed -i 's/bg-blue-100 text-blue-800/bg-blue-500\/20 text-blue-400/g' "$file"
    sed -i 's/bg-yellow-100 text-yellow-800/bg-yellow-500\/20 text-yellow-400/g' "$file"
    sed -i 's/bg-amber-100 text-amber-800/bg-amber-500\/20 text-amber-400/g' "$file"
    sed -i 's/bg-purple-100 text-purple-800/bg-purple-500\/20 text-purple-400/g' "$file"
    sed -i 's/bg-indigo-100 text-indigo-800/bg-indigo-500\/20 text-indigo-400/g' "$file"

    # Individual status badge parts
    sed -i 's/bg-green-100\([^-]\)/bg-green-500\/20\1/g' "$file"
    sed -i 's/text-green-800\([^-]\)/text-green-400\1/g' "$file"
    sed -i 's/bg-red-100\([^-]\)/bg-red-500\/20\1/g' "$file"
    sed -i 's/text-red-800\([^-]\)/text-red-400\1/g' "$file"
    sed -i 's/bg-blue-100\([^-]\)/bg-blue-500\/20\1/g' "$file"
    sed -i 's/text-blue-800\([^-]\)/text-blue-400\1/g' "$file"
    sed -i 's/bg-yellow-100\([^-]\)/bg-yellow-500\/20\1/g' "$file"
    sed-i 's/text-yellow-800\([^-]\)/text-yellow-400\1/g' "$file"
    sed -i 's/bg-amber-100\([^-]\)/bg-amber-500\/20\1/g' "$file"
    sed -i 's/text-amber-800\([^-]\)/text-amber-400\1/g' "$file"

    # Border colors for status cards
    sed -i 's/border-green-200\([^-]\)/border-green-500\/30\1/g' "$file"
    sed -i 's/border-red-200\([^-]\)/border-red-500\/30\1/g' "$file"
    sed -i 's/border-blue-200\([^-]\)/border-blue-500\/30\1/g' "$file"
    sed -i 's/border-yellow-200\([^-]\)/border-yellow-500\/30\1/g' "$file"
}

# Process all module files
echo "Processing SOW modules..."
find src/modules/sow -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing reports module..."
find src/modules/reports -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing nokia-equipment module..."
find src/modules/nokia-equipment -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing onemap module..."
find src/modules/onemap -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing kpi-dashboard module..."
find src/modules/kpi-dashboard -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing kpis module..."
find src/modules/kpis -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing daily-progress module..."
find src/modules/daily-progress -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing dashboard module..."
find src/modules/dashboard -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing admin module..."
find src/modules/admin -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing communications module..."
find src/modules/communications -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing field-app module..."
find src/modules/field-app/components -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing contractor-documents-report module..."
find src/modules/contractor-documents-report/components -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "Processing action-items module..."
find src/modules/action-items -name "*.tsx" -type f | while read file; do
    fix_file "$file"
done

echo "✅ Dark mode CSS variable conversion complete!"
echo "Files processed. Please review changes with: git diff"
