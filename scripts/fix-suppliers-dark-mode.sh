#!/bin/bash

# Script to fix dark mode in suppliers module
# Converts hardcoded colors to CSS variables

FILES=$(find /home/hein/Workspace/FF_Next.js/src/modules/suppliers -name "*.tsx" -type f)

for file in $FILES; do
  echo "Processing: $file"

  # Background colors
  sed -i 's/bg-white\([^-]\)/bg-[var(--ff-bg-secondary)]\1/g' "$file"
  sed -i 's/bg-gray-50\([^/]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"
  sed -i 's/bg-gray-100\([^/]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"

  # Text colors - primary
  sed -i 's/text-gray-900/text-[var(--ff-text-primary)]/g' "$file"
  sed -i 's/text-gray-800/text-[var(--ff-text-primary)]/g' "$file"
  sed -i 's/text-gray-700/text-[var(--ff-text-primary)]/g' "$file"

  # Text colors - secondary
  sed -i 's/text-gray-600/text-[var(--ff-text-secondary)]/g' "$file"
  sed-i 's/text-gray-500/text-[var(--ff-text-secondary)]/g' "$file"

  # Text colors - tertiary
  sed -i 's/text-gray-400/text-[var(--ff-text-tertiary)]/g' "$file"

  # Border colors
  sed -i 's/border-gray-200/border-[var(--ff-border-light)]/g' "$file"
  sed -i 's/border-gray-300/border-[var(--ff-border-light)]/g' "$file"

  # Hover backgrounds
  sed -i 's/hover:bg-gray-50/hover:bg-[var(--ff-bg-hover)]/g' "$file"
  sed -i 's/hover:bg-gray-100/hover:bg-[var(--ff-bg-hover)]/g' "$file"
  sed -i 's/hover:bg-gray-200/hover:bg-[var(--ff-bg-hover)]/g' "$file"

  # Hover text colors
  sed -i 's/hover:text-gray-900/hover:text-[var(--ff-text-primary)]/g' "$file"
  sed -i 's/hover:text-gray-700/hover:text-[var(--ff-text-primary)]/g' "$file"

  # Status badge conversions
  sed -i 's/bg-green-100 text-green-800/bg-green-500\/20 text-green-400/g' "$file"
  sed -i 's/bg-blue-100 text-blue-800/bg-blue-500\/20 text-blue-400/g' "$file"
  sed -i 's/bg-yellow-100 text-yellow-800/bg-yellow-500\/20 text-yellow-400/g' "$file"
  sed -i 's/bg-red-100 text-red-800/bg-red-500\/20 text-red-400/g' "$file"
  sed -i 's/bg-orange-100 text-orange-800/bg-orange-500\/20 text-orange-400/g' "$file"

  # Icon colors
  sed -i 's/text-green-600/text-green-400/g' "$file"
  sed -i 's/text-blue-600/text-blue-400/g' "$file"
  sed -i 's/text-yellow-600/text-yellow-400/g' "$file"
  sed -i 's/text-red-600/text-red-400/g' "$file"
  sed -i 's/text-orange-600/text-orange-400/g' "$file"

  # Button backgrounds
  sed -i 's/bg-blue-600/bg-blue-500/g' "$file"
  sed -i 's/hover:bg-blue-700/hover:bg-blue-600/g' "$file"
done

echo "Dark mode fix completed!"
