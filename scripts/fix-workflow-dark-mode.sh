#!/bin/bash

# Script to fix dark mode issues in workflow module
# Converts hardcoded Tailwind gray colors to CSS variables

echo "Fixing dark mode in workflow module..."

# List of files to fix
FILES=(
  "src/modules/workflow/components/editor/forms/index.tsx"
  "src/modules/workflow/components/editor/ComponentPalette.tsx"
  "src/modules/workflow/components/editor/ValidationPanel.tsx"
  "src/modules/workflow/components/editor/EditorMinimap.tsx"
  "src/modules/workflow/components/editor/PropertiesPanel.tsx"
  "src/modules/workflow/components/projects/ExecutionLogs.tsx"
  "src/modules/workflow/components/projects/WorkflowAssignmentModal.tsx"
  "src/modules/workflow/components/projects/WorkflowTimeline.tsx"
  "src/modules/workflow/components/projects/WorkflowProgress.tsx"
  "src/modules/workflow/components/projects/ProjectWorkflowList.tsx"
  "src/modules/workflow/components/projects/analytics/components/LoadingState.tsx"
  "src/modules/workflow/components/projects/analytics/components/AnalyticsHeader.tsx"
  "src/modules/workflow/components/projects/analytics/components/SuccessFactorsCard.tsx"
  "src/modules/workflow/components/projects/analytics/components/ErrorState.tsx"
  "src/modules/workflow/components/projects/analytics/components/TemplateUsageChart.tsx"
  "src/modules/workflow/components/projects/analytics/components/PhasePerformanceCard.tsx"
  "src/modules/workflow/components/projects/analytics/components/MetricCard.tsx"
  "src/modules/workflow/components/projects/analytics/components/BottlenecksCard.tsx"
  "src/modules/workflow/components/projects/ProjectWorkflowDetail.tsx"
  "src/modules/workflow/components/analytics/ReportExporter.tsx"
  "src/modules/workflow/components/analytics/LiveDashboard.tsx"
  "src/modules/workflow/components/analytics/ComparisonTools.tsx"
  "src/modules/workflow/components/analytics/TrendAnalysis.tsx"
  "src/modules/workflow/components/analytics/PerformanceMetrics.tsx"
  "src/modules/workflow/components/analytics/WorkflowCharts.tsx"
  "src/modules/workflow/components/tabs/AnalyticsTab.tsx"
  "src/modules/workflow/components/tabs/ProjectsTab.tsx"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing: $file"

    # Background colors
    sed -i 's/\bbg-white /bg-[var(--ff-bg-secondary)] /g' "$file"
    sed -i 's/\bbg-gray-50 /bg-[var(--ff-bg-tertiary)] /g' "$file"
    sed -i 's/\bbg-gray-100 /bg-[var(--ff-bg-hover)] /g' "$file"
    sed -i 's/\bbg-gray-200 /bg-[var(--ff-bg-hover)] /g' "$file"

    # Text colors
    sed -i 's/\btext-gray-900 /text-[var(--ff-text-primary)] /g' "$file"
    sed -i 's/\btext-gray-800 /text-[var(--ff-text-primary)] /g' "$file"
    sed -i 's/\btext-gray-700 /text-[var(--ff-text-primary)] /g' "$file"
    sed -i 's/\btext-gray-600 /text-[var(--ff-text-secondary)] /g' "$file"
    sed -i 's/\btext-gray-500 /text-[var(--ff-text-tertiary)] /g' "$file"
    sed -i 's/\btext-gray-400 /text-[var(--ff-text-tertiary)] /g' "$file"

    # Border colors
    sed -i 's/\bborder-gray-200 /border-[var(--ff-border-light)] /g' "$file"
    sed -i 's/\bborder-gray-300 /border-[var(--ff-border-light)] /g' "$file"

    # Hover states
    sed -i 's/\bhover:bg-gray-50 /hover:bg-[var(--ff-bg-hover)] /g' "$file"
    sed -i 's/\bhover:bg-gray-100 /hover:bg-[var(--ff-bg-hover)] /g' "$file"
    sed -i 's/\bhover:bg-gray-200 /hover:bg-[var(--ff-bg-hover)] /g' "$file"
    sed -i 's/\bhover:text-gray-900 /hover:text-[var(--ff-text-primary)] /g' "$file"
    sed -i 's/\bhover:text-gray-800 /hover:text-[var(--ff-text-primary)] /g' "$file"

    # Status badge patterns (convert to modern dark mode pattern)
    sed -i 's/bg-blue-100 text-blue-700/bg-blue-500\/20 text-blue-400/g' "$file"
    sed -i 's/bg-green-100 text-green-700/bg-green-500\/20 text-green-400/g' "$file"
    sed -i 's/bg-purple-100 text-purple-700/bg-purple-500\/20 text-purple-400/g' "$file"
    sed -i 's/bg-red-100 text-red-700/bg-red-500\/20 text-red-400/g' "$file"
    sed -i 's/bg-amber-100 text-amber-700/bg-amber-500\/20 text-amber-400/g' "$file"
    sed -i 's/bg-yellow-100 text-yellow-700/bg-yellow-500\/20 text-yellow-400/g' "$file"
    sed -i 's/bg-indigo-100 text-indigo-700/bg-indigo-500\/20 text-indigo-400/g' "$file"
    sed -i 's/bg-pink-100 text-pink-700/bg-pink-500\/20 text-pink-400/g' "$file"
    sed -i 's/bg-orange-100 text-orange-700/bg-orange-500\/20 text-orange-400/g' "$file"

    # Additional badge variants
    sed -i 's/bg-blue-100 text-blue-800/bg-blue-500\/20 text-blue-400/g' "$file"
    sed -i 's/bg-green-100 text-green-800/bg-green-500\/20 text-green-400/g' "$file"
    sed -i 's/bg-purple-100 text-purple-800/bg-purple-500\/20 text-purple-400/g' "$file"
    sed -i 's/bg-red-100 text-red-800/bg-red-500\/20 text-red-400/g' "$file"

    # Remove dark mode duplicates (these are now handled by CSS variables)
    sed -i 's/ dark:bg-gray-[0-9]*//g' "$file"
    sed -i 's/ dark:text-gray-[0-9]*//g' "$file"
    sed -i 's/ dark:border-gray-[0-9]*//g' "$file"
    sed -i 's/ dark:hover:bg-gray-[0-9]*//g' "$file"
    sed -i 's/ dark:hover:text-gray-[0-9]*//g' "$file"

    echo "  ✓ Fixed: $file"
  else
    echo "  ✗ Not found: $file"
  fi
done

echo ""
echo "✅ Dark mode fixes complete!"
echo "Files processed: ${#FILES[@]}"
echo ""
echo "Next steps:"
echo "1. Review changes: git diff"
echo "2. Test in browser with dark mode enabled"
echo "3. Commit if everything looks good"
