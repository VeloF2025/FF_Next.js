#!/bin/bash
# Script to convert procurement module files to CSS variables for dark mode
# Pattern replacements for dark mode compatibility

set -e

PROCUREMENT_DIR="src/modules/procurement"

echo "Converting procurement module files to CSS variables..."

# Find all TSX files in procurement module
find "$PROCUREMENT_DIR" -name "*.tsx" -type f | while read -r file; do
    echo "Processing: $file"

    # Background colors
    sed -i 's/bg-white\([^-]\)/bg-[var(--ff-bg-secondary)]\1/g' "$file"
    sed -i 's/bg-gray-50\([^0-9]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"
    sed -i 's/bg-gray-100\([^0-9]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"

    # Text colors
    sed -i 's/text-gray-900\([^0-9]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-800\([^0-9]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-700\([^0-9]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-600\([^0-9]\)/text-[var(--ff-text-secondary)]\1/g' "$file"
    sed -i 's/text-gray-500\([^0-9]\)/text-[var(--ff-text-secondary)]\1/g' "$file"
    sed -i 's/text-gray-400\([^0-9]\)/text-[var(--ff-text-tertiary)]\1/g' "$file"

    # Border colors
    sed -i 's/border-gray-200\([^0-9]\)/border-[var(--ff-border-light)]\1/g' "$file"
    sed -i 's/border-gray-300\([^0-9]\)/border-[var(--ff-border-light)]\1/g' "$file"
    sed -i 's/divide-gray-200\([^0-9]\)/divide-[var(--ff-border-light)]\1/g' "$file"

    # Hover states
    sed -i 's/hover:bg-gray-50\([^0-9]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"
    sed -i 's/hover:bg-gray-100\([^0-9]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"
    sed -i 's/hover:bg-gray-200\([^0-9]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"

    # Status badge patterns - convert to /20 opacity format
    sed -i 's/bg-red-100 text-red-800/bg-red-500\/20 text-red-400/g' "$file"
    sed -i 's/bg-red-100 text-red-700/bg-red-500\/20 text-red-400/g' "$file"
    sed -i 's/bg-yellow-100 text-yellow-800/bg-yellow-500\/20 text-yellow-400/g' "$file"
    sed -i 's/bg-yellow-100 text-yellow-700/bg-yellow-500\/20 text-yellow-400/g' "$file"
    sed -i 's/bg-green-100 text-green-800/bg-green-500\/20 text-green-400/g' "$file"
    sed -i 's/bg-green-100 text-green-700/bg-green-500\/20 text-green-400/g' "$file"
    sed -i 's/bg-blue-100 text-blue-800/bg-blue-500\/20 text-blue-400/g' "$file"
    sed -i 's/bg-blue-100 text-blue-700/bg-blue-500\/20 text-blue-400/g' "$file"
    sed -i 's/bg-purple-100 text-purple-800/bg-purple-500\/20 text-purple-400/g' "$file"
    sed -i 's/bg-purple-100 text-purple-700/bg-purple-500\/20 text-purple-400/g' "$file"
    sed -i 's/bg-indigo-100 text-indigo-800/bg-indigo-500\/20 text-indigo-400/g' "$file"
    sed -i 's/bg-indigo-100 text-indigo-700/bg-indigo-500\/20 text-indigo-400/g' "$file"
    sed -i 's/bg-orange-100 text-orange-800/bg-orange-500\/20 text-orange-400/g' "$file"
    sed -i 's/bg-orange-100 text-orange-700/bg-orange-500\/20 text-orange-400/g' "$file"

    # Individual badge backgrounds
    sed -i 's/bg-red-100\([^0-9]\)/bg-red-500\/20\1/g' "$file"
    sed -i 's/bg-yellow-100\([^0-9]\)/bg-yellow-500\/20\1/g' "$file"
    sed -i 's/bg-green-100\([^0-9]\)/bg-green-500\/20\1/g' "$file"
    sed -i 's/bg-blue-100\([^0-9]\)/bg-blue-500\/20\1/g' "$file"
    sed -i 's/bg-purple-100\([^0-9]\)/bg-purple-500\/20\1/g' "$file"
    sed -i 's/bg-indigo-100\([^0-9]\)/bg-indigo-500\/20\1/g' "$file"
    sed -i 's/bg-orange-100\([^0-9]\)/bg-orange-500\/20\1/g' "$file"

    # Badge text colors (after background conversions)
    sed -i 's/text-red-800\([^0-9]\)/text-red-400\1/g' "$file"
    sed -i 's/text-red-700\([^0-9]\)/text-red-400\1/g' "$file"
    sed -i 's/text-yellow-800\([^0-9]\)/text-yellow-400\1/g' "$file"
    sed -i 's/text-yellow-700\([^0-9]\)/text-yellow-400\1/g' "$file"
    sed -i 's/text-green-800\([^0-9]\)/text-green-400\1/g' "$file"
    sed -i 's/text-green-700\([^0-9]\)/text-green-400\1/g' "$file"
    sed -i 's/text-blue-800\([^0-9]\)/text-blue-400\1/g' "$file"
    sed -i 's/text-blue-700\([^0-9]\)/text-blue-400\1/g' "$file"
    sed -i 's/text-purple-800\([^0-9]\)/text-purple-400\1/g' "$file"
    sed -i 's/text-purple-700\([^0-9]\)/text-purple-400\1/g' "$file"
    sed -i 's/text-indigo-800\([^0-9]\)/text-indigo-400\1/g' "$file"
    sed -i 's/text-indigo-700\([^0-9]\)/text-indigo-400\1/g' "$file"
    sed -i 's/text-orange-800\([^0-9]\)/text-orange-400\1/g' "$file"
    sed -i 's/text-orange-700\([^0-9]\)/text-orange-400\1/g' "$file"

    # Progress bar backgrounds
    sed -i 's/bg-gray-200 /bg-[var(--ff-bg-tertiary)] /g' "$file"

done

echo "Conversion complete!"
echo "Total files processed: $(find "$PROCUREMENT_DIR" -name "*.tsx" -type f | wc -l)"
