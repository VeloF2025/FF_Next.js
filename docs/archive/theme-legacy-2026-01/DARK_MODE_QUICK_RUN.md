# Dark Mode Batch 2 - Quick Run Guide

## TL;DR

```bash
cd /home/hein/Workspace/FF_Next.js

# Run the automated fix
bash scripts/fix-dark-mode-batch2.sh

# Review changes
git diff --stat

# Test
npm run build && PORT=3005 npm start

# If good, commit
git add .
git commit -m "fix: convert batch 2 components to CSS variables for dark mode"

# If bad, rollback
git checkout -- src/components/{procurement,sow,settings}
```

## What Gets Fixed

- **50 files** in `procurement/`, `sow/`, and `settings/ServiceTemplatesTab.tsx`
- **30+ color patterns** converted to CSS variables
- **Automatic backups** created (`.bak` files)

## Files Already Fixed (Manual)

✅ `onemap/ImportWizard.tsx`
✅ `onemap/ImportAssistant.tsx`
✅ `realtime/ConnectionStatus.tsx`
✅ `search/GlobalSearch.tsx`
✅ `settings/VFLogoUpload.tsx`
✅ `settings/RemindersTab.tsx` (already compliant)

## Key Conversions

```
bg-white          → bg-[var(--ff-bg-secondary)]
text-gray-900     → text-[var(--ff-text-primary)]
border-gray-300   → border-[var(--ff-border-light)]
bg-green-100      → bg-green-500/20
text-green-800    → text-green-400
```

## After Running

1. **Test dark mode toggle** in browser
2. **Check procurement pages** (BOQ, RFQ)
3. **Check SOW viewer and upload**
4. **Check Settings → Service Templates**

## Cleanup

```bash
# Remove backups when satisfied
find src/components/{procurement,settings,sow} -name '*.bak' -delete
```

## Full Details

See: `docs/DARK_MODE_BATCH2_SUMMARY.md`

---

**Total:** 57 files
**Manual:** 7 files ✅
**Automated:** 50 files (script)
