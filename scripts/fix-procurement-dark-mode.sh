#!/bin/bash
# Fix all dark mode issues in procurement module
# Converts hardcoded colors to CSS variables

PROC_DIR="/home/hein/Workspace/FF_Next.js/src/modules/procurement"

echo "Fixing dark mode in procurement module..."

# Find all TSX files
find "$PROC_DIR" -type f -name "*.tsx" | while read -r file; do
  echo "Processing: $file"

  # Background colors
  sed -i 's/bg-white\b/bg-[var(--ff-bg-secondary)]/g' "$file"
  sed -i 's/bg-gray-50\b/bg-[var(--ff-bg-tertiary)]/g' "$file"
  sed -i 's/bg-gray-100\b/bg-[var(--ff-bg-tertiary)]/g' "$file"

  # Text colors
  sed -i 's/text-gray-900\b/text-[var(--ff-text-primary)]/g' "$file"
  sed -i 's/text-gray-800\b/text-[var(--ff-text-primary)]/g' "$file"
  sed -i 's/text-gray-700\b/text-[var(--ff-text-secondary)]/g' "$file"
  sed -i 's/text-gray-600\b/text-[var(--ff-text-secondary)]/g' "$file"
  sed -i 's/text-gray-500\b/text-[var(--ff-text-secondary)]/g' "$file"
  sed -i 's/text-gray-400\b/text-[var(--ff-text-tertiary)]/g' "$file"

  # Border colors
  sed -i 's/border-gray-200\b/border-[var(--ff-border-light)]/g' "$file"
  sed -i 's/border-gray-300\b/border-[var(--ff-border-light)]/g' "$file"

  # Hover states
  sed -i 's/hover:bg-gray-50\b/hover:bg-[var(--ff-bg-hover)]/g' "$file"
  sed -i 's/hover:bg-gray-100\b/hover:bg-[var(--ff-bg-hover)]/g' "$file"
  sed -i 's/hover:bg-gray-200\b/hover:bg-[var(--ff-bg-hover)]/g' "$file"

  # Status badge backgrounds (convert to semi-transparent)
  sed -i 's/\bbg-blue-100\b/bg-blue-500\/20/g' "$file"
  sed -i 's/\bbg-green-100\b/bg-green-500\/20/g' "$file"
  sed -i 's/\bbg-yellow-100\b/bg-yellow-500\/20/g' "$file"
  sed -i 's/\bbg-red-100\b/bg-red-500\/20/g' "$file"
  sed -i 's/\bbg-purple-100\b/bg-purple-500\/20/g' "$file"
  sed -i 's/\bbg-orange-100\b/bg-orange-500\/20/g' "$file"
  sed -i 's/\bbg-indigo-100\b/bg-indigo-500\/20/g' "$file"

  # Status badge text colors
  sed -i 's/\btext-blue-800\b/text-blue-400/g' "$file"
  sed -i 's/\btext-green-800\b/text-green-400/g' "$file"
  sed -i 's/\btext-yellow-800\b/text-yellow-400/g' "$file"
  sed -i 's/\btext-red-800\b/text-red-400/g' "$file"
  sed -i 's/\btext-purple-800\b/text-purple-400/g' "$file"
  sed -i 's/\btext-orange-800\b/text-orange-400/g' "$file"
  sed -i 's/\btext-indigo-800\b/text-indigo-400/g' "$file"

  # Additional status variants
  sed -i 's/\bbg-blue-50\b/bg-blue-500\/20/g' "$file"
  sed -i 's/\bbg-green-50\b/bg-green-500\/20/g' "$file"
  sed -i 's/\bbg-yellow-50\b/bg-yellow-500\/20/g' "$file"
  sed -i 's/\bbg-red-50\b/bg-red-500\/20/g' "$file"
  sed -i 's/\bbg-purple-50\b/bg-purple-500\/20/g' "$file"
  sed -i 's/\bbg-orange-50\b/bg-orange-500\/20/g' "$file"

  sed -i 's/\btext-blue-700\b/text-blue-300/g' "$file"
  sed -i 's/\btext-green-700\b/text-green-300/g' "$file"
  sed -i 's/\btext-yellow-700\b/text-yellow-300/g' "$file"
  sed -i 's/\btext-red-700\b/text-red-300/g' "$file"
  sed -i 's/\btext-purple-700\b/text-purple-300/g' "$file"
  sed -i 's/\btext-orange-700\b/text-orange-300/g' "$file"

  # Border status colors
  sed -i 's/\bborder-blue-200\b/border-blue-500\/30/g' "$file"
  sed -i 's/\bborder-green-200\b/border-green-500\/30/g' "$file"
  sed -i 's/\bborder-yellow-200\b/border-yellow-500\/30/g' "$file"
  sed -i 's/\bborder-red-200\b/border-red-500\/30/g' "$file"
  sed -i 's/\bborder-purple-200\b/border-purple-500\/30/g' "$file"
  sed -i 's/\bborder-orange-200\b/border-orange-500\/30/g' "$file"
done

echo "✅ Done! Fixed dark mode in all procurement files."
