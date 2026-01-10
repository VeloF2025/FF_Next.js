#!/bin/bash
# Batch fix dark mode in remaining components

FILES=(
  "src/components/settings/RemindersTab.tsx"
  "src/components/settings/ServiceTemplatesTab.tsx"
  "src/components/settings/VFLogoUpload.tsx"
  "src/components/onemap/ImportWizard.tsx"
  "src/components/onemap/ImportAssistant.tsx"
  "src/components/forms/UniversalField.tsx"
  "src/components/forms/FieldSection.tsx"
  "src/components/error/DatabaseErrorBoundary.tsx"
  "src/components/dev/FirebaseTest.tsx"
  "src/components/dev/ProjectsDebug.tsx"
  "src/components/dev/StaffDebug.tsx"
  "src/components/dev/ClientsDebug.tsx"
  "src/components/demo/FileImportDemo.tsx"
  "src/components/ui/ChartErrorBoundary.tsx"
  "src/components/ui/DynamicChart.tsx"
  "src/components/ui/GlassCard.tsx"
  "src/components/ui/StandardActionButtons.tsx"
  "src/components/ui/VelocityButton.tsx"
  "src/components/ui/VirtualizedList.tsx"
  "src/components/database/DatabaseHealthIndicator.tsx"
  "src/components/search/GlobalSearch.tsx"
  "src/components/FibreFlowDashboard.tsx"
  "src/components/VersionChecker.tsx"
  "src/components/ErrorBoundary.tsx"
  "src/components/dashboard/EnhancedStatCard.tsx"
  "src/components/realtime/ConnectionStatus.tsx"
)

echo "Fixing dark mode in ${#FILES[@]} files..."

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing: $file"

    # bg-white -> bg-[var(--ff-bg-secondary)]
    sed -i 's/bg-white\([^-]\)/bg-[var(--ff-bg-secondary)]\1/g' "$file"
    sed -i 's/bg-white"/bg-[var(--ff-bg-secondary)]"/g' "$file"
    sed -i 's/bg-white /bg-[var(--ff-bg-secondary)] /g' "$file"
    sed -i 's/bg-white$/bg-[var(--ff-bg-secondary)]/g' "$file"

    # bg-gray-50/100 -> bg-[var(--ff-bg-tertiary)]
    sed -i 's/bg-gray-50\([^0-9]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"
    sed -i 's/bg-gray-100\([^0-9]\)/bg-[var(--ff-bg-tertiary)]\1/g' "$file"

    # text-gray-900/800/700 -> text-[var(--ff-text-primary)]
    sed -i 's/text-gray-900\([^0-9]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-800\([^0-9]\)/text-[var(--ff-text-primary)]\1/g' "$file"
    sed -i 's/text-gray-700\([^0-9]\)/text-[var(--ff-text-primary)]\1/g' "$file"

    # text-gray-600/500 -> text-[var(--ff-text-secondary)]
    sed -i 's/text-gray-600\([^0-9]\)/text-[var(--ff-text-secondary)]\1/g' "$file"
    sed -i 's/text-gray-500\([^0-9]\)/text-[var(--ff-text-secondary)]\1/g' "$file"

    # text-gray-400 -> text-[var(--ff-text-tertiary)]
    sed -i 's/text-gray-400\([^0-9]\)/text-[var(--ff-text-tertiary)]\1/g' "$file"

    # border-gray-200/300 -> border-[var(--ff-border-light)]
    sed -i 's/border-gray-200\([^0-9]\)/border-[var(--ff-border-light)]\1/g' "$file"
    sed -i 's/border-gray-300\([^0-9]\)/border-[var(--ff-border-light)]\1/g' "$file"

    # hover:bg-gray-50/100/200 -> hover:bg-[var(--ff-bg-hover)]
    sed -i 's/hover:bg-gray-50\([^0-9]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"
    sed -i 's/hover:bg-gray-100\([^0-9]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"
    sed -i 's/hover:bg-gray-200\([^0-9]\)/hover:bg-[var(--ff-bg-hover)]\1/g' "$file"

    # Remove dark: variants that are now replaced
    sed -i 's/ dark:bg-gray-[0-9]\+//g' "$file"
    sed -i 's/ dark:text-gray-[0-9]\+//g' "$file"
    sed -i 's/ dark:border-gray-[0-9]\+//g' "$file"
    sed -i 's/ dark:hover:bg-gray-[0-9]\+//g' "$file"

    # Status badge patterns: bg-{color}-100 text-{color}-800 -> bg-{color}-500/20 text-{color}-400
    # Red badges
    sed -i 's/bg-red-100 text-red-800/bg-red-500\/20 text-red-400/g' "$file"
    sed -i 's/bg-red-50 text-red-700/bg-red-500\/20 text-red-400/g' "$file"

    # Green badges
    sed -i 's/bg-green-100 text-green-800/bg-green-500\/20 text-green-400/g' "$file"
    sed -i 's/bg-green-50 text-green-700/bg-green-500\/20 text-green-400/g' "$file"

    # Blue badges
    sed -i 's/bg-blue-100 text-blue-800/bg-blue-500\/20 text-blue-400/g' "$file"
    sed -i 's/bg-blue-50 text-blue-700/bg-blue-500\/20 text-blue-400/g' "$file"

    # Yellow/Amber badges
    sed -i 's/bg-yellow-100 text-yellow-800/bg-yellow-500\/20 text-yellow-400/g' "$file"
    sed -i 's/bg-amber-100 text-amber-800/bg-amber-500\/20 text-amber-400/g' "$file"

    # Hover backgrounds on colored elements
    sed -i 's/hover:bg-red-50 /hover:bg-red-500\/20 /g' "$file"
    sed -i 's/hover:bg-green-50 /hover:bg-green-500\/20 /g' "$file"
    sed -i 's/hover:bg-blue-50 /hover:bg-blue-500\/20 /g' "$file"

  else
    echo "  File not found: $file"
  fi
done

echo "Done! Fixed ${#FILES[@]} files"
