# Dark Mode Fix Status

## Completed
- ✓ src/components/settings/RemindersTab.tsx - Manually fixed all patterns

## Automated Fix Available
Run the following command to fix all remaining files:

```bash
python3 scripts/fix-dark-mode.py
```

This will automatically fix 25 files:

### Settings Components (2 files)
- src/components/settings/ServiceTemplatesTab.tsx
- src/components/settings/VFLogoUpload.tsx

### OneMap Components (2 files)
- src/components/onemap/ImportWizard.tsx
- src/components/onemap/ImportAssistant.tsx

### Forms Components (2 files)
- src/components/forms/UniversalField.tsx
- src/components/forms/FieldSection.tsx

### Error Components (1 file)
- src/components/error/DatabaseErrorBoundary.tsx

### Dev Components (4 files)
- src/components/dev/FirebaseTest.tsx
- src/components/dev/ProjectsDebug.tsx
- src/components/dev/StaffDebug.tsx
- src/components/dev/ClientsDebug.tsx

### Demo Components (1 file)
- src/components/demo/FileImportDemo.tsx

### UI Components (6 files)
- src/components/ui/ChartErrorBoundary.tsx
- src/components/ui/DynamicChart.tsx
- src/components/ui/GlassCard.tsx
- src/components/ui/StandardActionButtons.tsx
- src/components/ui/VelocityButton.tsx
- src/components/ui/VirtualizedList.tsx

### Other Components (7 files)
- src/components/database/DatabaseHealthIndicator.tsx
- src/components/search/GlobalSearch.tsx
- src/components/FibreFlowDashboard.tsx
- src/components/VersionChecker.tsx
- src/components/ErrorBoundary.tsx
- src/components/dashboard/EnhancedStatCard.tsx
- src/components/realtime/ConnectionStatus.tsx

## Conversion Patterns

The script converts:

### Background Colors
- `bg-white` → `bg-[var(--ff-bg-secondary)]`
- `bg-gray-50/100` → `bg-[var(--ff-bg-tertiary)]`

### Text Colors
- `text-gray-900/800/700` → `text-[var(--ff-text-primary)]`
- `text-gray-600/500` → `text-[var(--ff-text-secondary)]`
- `text-gray-400/300` → `text-[var(--ff-text-tertiary)]`

### Border Colors
- `border-gray-200/300` → `border-[var(--ff-border-light)]`

### Hover States
- `hover:bg-gray-50/100/200` → `hover:bg-[var(--ff-bg-hover)]`

### Status Badges
- `bg-red-100 text-red-800` → `bg-red-500/20 text-red-400`
- `bg-green-100 text-green-800` → `bg-green-500/20 text-green-400`
- `bg-blue-100 text-blue-800` → `bg-blue-500/20 text-blue-400`
- `bg-yellow/amber-100 text-yellow/amber-800` → `bg-{color}-500/20 text-{color}-400`

### Colored Hover States
- `hover:bg-red/green/blue/yellow-50` → `hover:bg-{color}-500/20`

### Dark Mode Variants Removed
- All `dark:bg-gray-*`, `dark:text-gray-*`, `dark:border-gray-*` variants are removed as they're now handled by CSS variables

## Manual Partial Fix
- src/components/settings/ServiceTemplatesTab.tsx - Started but needs completion

## How to Run

```bash
# Make script executable
chmod +x scripts/fix-dark-mode.py

# Run the fixer
python3 scripts/fix-dark-mode.py
```

## After Running

1. Test the application in both light and dark modes
2. Check for any visual regressions
3. Verify all components render correctly
4. Commit the changes

## Note

Files in these directories were already fixed in previous work:
- src/components/procurement/
- src/components/sow/
- src/components/contractors/
- src/components/contractor/
- src/components/staff/
- src/components/auth/
- src/components/clients/
