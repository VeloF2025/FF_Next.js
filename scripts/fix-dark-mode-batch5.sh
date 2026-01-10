#!/bin/bash

# Dark mode color conversion script for BATCH 5 modules
# Converts hardcoded Tailwind colors to CSS variables

MODULES_DIR="/home/hein/Workspace/FF_Next.js/src/modules"

# Target modules for batch 5
MODULES=(
  "action-items"
  "admin"
  "analytics"
  "clients"
  "communications"
  "contractor-documents-report"
  "daily-progress"
  "dashboard"
  "installations"
  "kpi-dashboard"
  "kpis"
  "nokia-equipment"
  "onemap"
  "reports"
  "settings"
  "staff"
)

echo "Starting dark mode conversion for BATCH 5 modules..."

for module in "${MODULES[@]}"; do
  MODULE_PATH="$MODULES_DIR/$module"

  if [ ! -d "$MODULE_PATH" ]; then
    echo "Warning: Module directory not found: $MODULE_PATH"
    continue
  fi

  echo "Processing module: $module"

  # Find all .tsx and .ts files in the module
  find "$MODULE_PATH" -type f \( -name "*.tsx" -o -name "*.ts" \) | while read -r file; do
    echo "  Fixing: $(basename "$file")"

    # Background colors
    sed -i 's/bg-white\([^-]\)/bg-[var(--ff-bg-secondary)]\1/g' "$file"
    sed -i 's/bg-white"/bg-[var(--ff-bg-secondary)]"/g' "$file"
    sed -i 's/bg-gray-50\([^0-9]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"
    sed -i 's/bg-gray-50"/bg-[var(--ff-bg-tertiary)]"/g' "$file"
    sed -i 's/bg-gray-100\([^0-9]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"
    sed -i 's/bg-gray-100"/bg-[var(--ff-bg-tertiary)]"/g' "$file"

    # Text colors
    sed -i 's/text-gray-900\([^0-9]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-900"/text-[var(--ff-text-primary)]"/g' "$file"
    sed -i 's/text-gray-800\([^0-9]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-800"/text-[var(--ff-text-primary)]"/g' "$file"
    sed -i 's/text-gray-700\([^0-9]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-700"/text-[var(--ff-text-primary)]"/g' "$file"
    sed -i 's/text-gray-600\([^0-9]\)/text-[var(--ff-text-secondary)]\1/g' "$file"
    sed -i 's/text-gray-600"/text-[var(--ff-text-secondary)]"/g' "$file"
    sed -i 's/text-gray-500\([^0-9]\)/text-[var(--ff-text-secondary)]\1/g' "$file"
    sed -i 's/text-gray-500"/text-[var(--ff-text-secondary)]"/g' "$file"
    sed -i 's/text-gray-400\([^0-9]\)/text-[var(--ff-text-tertiary)]\1/g' "$file"
    sed -i 's/text-gray-400"/text-[var(--ff-text-tertiary)]"/g' "$file"

    # Border colors
    sed -i 's/border-gray-200\([^0-9]\)/border-[var(--ff-border-light)]\1/g' "$file"
    sed -i 's/border-gray-200"/border-[var(--ff-border-light)]"/g' "$file"
    sed -i 's/border-gray-300\([^0-9]\)/border-[var(--ff-border-light)]\1/g' "$file"
    sed -i 's/border-gray-300"/border-[var(--ff-border-light)]"/g' "$file"

    # Hover backgrounds
    sed -i 's/hover:bg-gray-50\([^0-9]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"
    sed -i 's/hover:bg-gray-50"/hover:bg-[var(--ff-bg-hover)]"/g' "$file"
    sed -i 's/hover:bg-gray-100\([^0-9]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"
    sed -i 's/hover:bg-gray-100"/hover:bg-[var(--ff-bg-hover)]"/g' "$file"

    # Hover text colors
    sed -i 's/hover:text-gray-900\([^0-9]\)/hover:text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/hover:text-gray-900"/hover:text-[var(--ff-text-primary)]"/g' "$file"
    sed -i 's/hover:text-gray-700\([^0-9]\)/hover:text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/hover:text-gray-700"/hover:text-[var(--ff-text-primary)]"/g' "$file"

    # Status badge patterns (old format bg-{color}-100 text-{color}-800 → new format)
    sed -i 's/bg-red-100 text-red-800/bg-red-500\/20 text-red-400/g' "$file"
    sed -i 's/bg-orange-100 text-orange-800/bg-orange-500\/20 text-orange-400/g' "$file"
    sed -i 's/bg-yellow-100 text-yellow-800/bg-yellow-500\/20 text-yellow-400/g' "$file"
    sed -i 's/bg-green-100 text-green-800/bg-green-500\/20 text-green-400/g' "$file"
    sed -i 's/bg-blue-100 text-blue-800/bg-blue-500\/20 text-blue-400/g' "$file"
    sed -i 's/bg-indigo-100 text-indigo-800/bg-indigo-500\/20 text-indigo-400/g' "$file"
    sed -i 's/bg-purple-100 text-purple-800/bg-purple-500\/20 text-purple-400/g' "$file"
    sed -i 's/bg-pink-100 text-pink-800/bg-pink-500\/20 text-pink-400/g' "$file"

    # Individual bg-{color}-100 patterns for badges/icons
    sed -i 's/bg-red-100\([^0-9]\)/bg-red-500\/20\1/g' "$file"
    sed -i 's/bg-red-100"/bg-red-500\/20"/g' "$file"
    sed -i 's/bg-orange-100\([^0-9]\)/bg-orange-500\/20\1/g' "$file"
    sed -i 's/bg-orange-100"/bg-orange-500\/20"/g' "$file"
    sed -i 's/bg-yellow-100\([^0-9]\)/bg-yellow-500\/20\1/g' "$file"
    sed -i 's/bg-yellow-100"/bg-yellow-500\/20"/g' "$file"
    sed -i 's/bg-green-100\([^0-9]\)/bg-green-500\/20\1/g' "$file"
    sed -i 's/bg-green-100"/bg-green-500\/20"/g' "$file"
    sed -i 's/bg-blue-100\([^0-9]\)/bg-blue-500\/20\1/g' "$file"
    sed -i 's/bg-blue-100"/bg-blue-500\/20"/g' "$file"
    sed -i 's/bg-purple-100\([^0-9]\)/bg-purple-500\/20\1/g' "$file"
    sed -i 's/bg-purple-100"/bg-purple-500\/20"/g' "$file"

  done
done

echo "Dark mode conversion completed for BATCH 5!"
echo "Please review the changes and test the modules."
