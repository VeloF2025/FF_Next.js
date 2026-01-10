# Dark Mode Module Conversion Script

## Quick Start

```bash
# 1. Make the script executable
chmod +x scripts/apply-dark-mode-to-modules.sh

# 2. Run the script
./scripts/apply-dark-mode-to-modules.sh

# 3. Review changes
git diff src/modules/

# 4. Test the application
npm run build && PORT=3005 npm start
```

## What This Script Does

Converts **all hardcoded Tailwind color classes** in module files to **CSS variables** for proper dark mode support.

### Modules Processed
- ✅ SOW (Statement of Work)
- ✅ Reports
- ✅ Nokia Equipment
- ✅ OneMap
- ✅ Installations
- ✅ KPI Dashboard
- ✅ KPIs
- ✅ Daily Progress
- ✅ Dashboard
- ✅ Admin
- ✅ Communications
- ✅ Field App
- ✅ Contractor Documents Report
- ✅ Action Items

### Example Conversions

**Before:**
```tsx
<div className="bg-white border border-gray-200">
  <h2 className="text-gray-900">Title</h2>
  <p className="text-gray-600">Description</p>
  <span className="bg-green-100 text-green-800">Active</span>
</div>
```

**After:**
```tsx
<div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
  <h2 className="text-[var(--ff-text-primary)]">Title</h2>
  <p className="text-[var(--ff-text-secondary)]">Description</p>
  <span className="bg-green-500/20 text-green-400">Active</span>
</div>
```

## Safety Features

- ✅ Creates `.backup` files before modifying
- ✅ Only processes `.tsx` files
- ✅ Uses word boundaries to avoid partial matches
- ✅ Removes backups only after successful conversion
- ✅ Shows progress for each file

## If Something Goes Wrong

### Restore from Backups
```bash
# Find all backup files
find src/modules -name "*.backup"

# Restore a specific file
mv src/modules/sow/SOWDashboard.tsx.backup src/modules/sow/SOWDashboard.tsx

# Restore all files (if needed)
find src/modules -name "*.backup" -exec bash -c 'mv "$0" "${0%.backup}"' {} \;
```

### Or Use Git
```bash
# Discard all changes
git checkout -- src/modules/

# Then run the script again
./scripts/apply-dark-mode-to-modules.sh
```

## Verification Checklist

After running the script:

- [ ] Run `git diff src/modules/` to review changes
- [ ] Build the application: `npm run build`
- [ ] Start dev server: `PORT=3005 npm start`
- [ ] Toggle dark mode in the app
- [ ] Check these components:
  - [ ] Dashboard cards and stats
  - [ ] Tables (headers, rows, hover states)
  - [ ] Status badges (green, red, yellow, blue)
  - [ ] Forms and inputs
  - [ ] Modals and dropdowns
  - [ ] Navigation and tabs

## Common Patterns Fixed

| Pattern | Before | After |
|---------|--------|-------|
| Card Background | `bg-white` | `bg-[var(--ff-bg-secondary)]` |
| Alt Background | `bg-gray-50` | `bg-[var(--ff-bg-tertiary)]` |
| Primary Text | `text-gray-900` | `text-[var(--ff-text-primary)]` |
| Secondary Text | `text-gray-600` | `text-[var(--ff-text-secondary)]` |
| Borders | `border-gray-200` | `border-[var(--ff-border-light)]` |
| Hover BG | `hover:bg-gray-50` | `hover:bg-[var(--ff-bg-hover)]` |
| Success Badge | `bg-green-100 text-green-800` | `bg-green-500/20 text-green-400` |
| Error Badge | `bg-red-100 text-red-800` | `bg-red-500/20 text-red-400` |

## Performance Notes

- Processes ~40-50 files in < 5 seconds
- Uses Perl for fast regex processing
- Minimal memory footprint

## Troubleshooting

### Script Won't Run
```bash
# Check if script is executable
ls -l scripts/apply-dark-mode-to-modules.sh

# Make it executable
chmod +x scripts/apply-dark-mode-to-modules.sh
```

### Perl Not Found
```bash
# Install Perl (Ubuntu/Debian)
sudo apt-get install perl

# Install Perl (Mac)
brew install perl
```

### Some Files Not Changed
This is normal - files may already use CSS variables or not have colors to convert.

## Related Files

- `DARK_MODE_MODULE_CONVERSION.md` - Detailed conversion summary
- `src/app/globals.css` - CSS variable definitions
- `src/components/*` - Components already converted

## Support

If you encounter issues:
1. Check the backup files
2. Review git diff carefully
3. Test in both light and dark modes
4. Check browser console for errors
