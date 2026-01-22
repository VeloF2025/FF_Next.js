# Dark Mode Fix Commands for Suppliers Module

Run these commands in your terminal to fix all remaining dark mode issues in the suppliers module:

```bash
cd /home/hein/Workspace/FF_Next.js

# Fix all .tsx files in suppliers/components/tabs recursively
find src/modules/suppliers/components/tabs -name "*.tsx" -type f -exec sed -i \
  -e 's/\bbg-white\b/bg-[var(--ff-bg-secondary)]/g' \
  -e 's/\bbg-gray-50\b/bg-[var(--ff-bg-tertiary)]/g' \
  -e 's/bg-gray-100\([^/]\)/bg-[var(--ff-bg-tertiary)]\1/g' \
  -e 's/\btext-gray-900\b/text-[var(--ff-text-primary)]/g' \
  -e 's/\btext-gray-800\b/text-[var(--ff-text-primary)]/g' \
  -e 's/\btext-gray-700\b/text-[var(--ff-text-primary)]/g' \
  -e 's/\btext-gray-600\b/text-[var(--ff-text-secondary)]/g' \
  -e 's/\btext-gray-500\b/text-[var(--ff-text-secondary)]/g' \
  -e 's/\btext-gray-400\b/text-[var(--ff-text-tertiary)]/g' \
  -e 's/\bborder-gray-200\b/border-[var(--ff-border-light)]/g' \
  -e 's/\bborder-gray-300\b/border-[var(--ff-border-light)]/g' \
  -e 's/\bhover:bg-gray-50\b/hover:bg-[var(--ff-bg-hover)]/g' \
  -e 's/\bhover:bg-gray-100\b/hover:bg-[var(--ff-bg-hover)]/g' \
  -e 's/\bhover:text-gray-900\b/hover:text-[var(--ff-text-primary)]/g' \
  -e 's/\bhover:text-gray-700\b/hover:text-[var(--ff-text-primary)]/g' \
  -e 's/bg-green-100 text-green-800/bg-green-500\/20 text-green-400/g' \
  -e 's/bg-blue-100 text-blue-800/bg-blue-500\/20 text-blue-400/g' \
  -e 's/bg-yellow-100 text-yellow-800/bg-yellow-500\/20 text-yellow-400/g' \
  -e 's/bg-red-100 text-red-800/bg-red-500\/20 text-red-400/g' \
  -e 's/bg-orange-100 text-orange-800/bg-orange-500\/20 text-orange-400/g' \
  -e 's/bg-purple-100 text-purple-800/bg-purple-500\/20 text-purple-400/g' \
  -e 's/bg-gray-100 text-gray-800/bg-gray-500\/20 text-gray-400/g' \
  -e 's/\btext-green-600\b/text-green-400/g' \
  -e 's/\btext-green-700\b/text-green-400/g' \
  -e 's/\btext-green-800\b/text-green-400/g' \
  -e 's/\btext-green-900\b/text-green-400/g' \
  -e 's/\btext-blue-600\b/text-blue-400/g' \
  -e 's/\btext-blue-700\b/text-blue-400/g' \
  -e 's/\btext-blue-800\b/text-blue-400/g' \
  -e 's/\btext-blue-900\b/text-blue-400/g' \
  -e 's/\btext-yellow-600\b/text-yellow-400/g' \
  -e 's/\btext-yellow-700\b/text-yellow-400/g' \
  -e 's/\btext-yellow-800\b/text-yellow-400/g' \
  -e 's/\btext-yellow-900\b/text-yellow-400/g' \
  -e 's/\btext-red-600\b/text-red-400/g' \
  -e 's/\btext-red-700\b/text-red-400/g' \
  -e 's/\btext-red-800\b/text-red-400/g' \
  -e 's/\btext-red-900\b/text-red-400/g' \
  -e 's/\btext-orange-600\b/text-orange-400/g' \
  -e 's/\btext-orange-700\b/text-orange-400/g' \
  -e 's/\btext-orange-800\b/text-orange-400/g' \
  -e 's/\btext-orange-900\b/text-orange-400/g' \
  -e 's/\btext-purple-600\b/text-purple-400/g' \
  -e 's/\btext-purple-700\b/text-purple-400/g' \
  -e 's/\btext-purple-800\b/text-purple-400/g' \
  -e 's/\btext-purple-900\b/text-purple-400/g' \
  -e 's/bg-green-50\([^/]\)/bg-green-500\/10\1/g' \
  -e 's/bg-blue-50\([^/]\)/bg-blue-500\/10\1/g' \
  -e 's/bg-yellow-50\([^/]\)/bg-yellow-500\/10\1/g' \
  -e 's/bg-red-50\([^/]\)/bg-red-500\/10\1/g' \
  -e 's/bg-orange-50\([^/]\)/bg-orange-500\/10\1/g' \
  -e 's/bg-purple-50\([^/]\)/bg-purple-500\/10\1/g' \
  -e 's/border-green-200/border-green-500\/30/g' \
  -e 's/border-blue-200/border-blue-500\/30/g' \
  -e 's/border-yellow-200/border-yellow-500\/30/g' \
  -e 's/border-red-200/border-red-500\/30/g' \
  -e 's/border-orange-200/border-orange-500\/30/g' \
  -e 's/border-purple-200/border-purple-500\/30/g' \
  -e 's/\bbg-blue-600\b/bg-blue-500/g' \
  -e 's/\bhover:bg-blue-700\b/hover:bg-blue-600/g' \
  {} \;

echo "Dark mode fix completed for all tab files!"
```

## Manual Review Needed

After running the script, manually review these files for context-specific fixes:
- **SuppliersPortalPage.tsx** - Main portal page
- **CompanyProfileTab.tsx** - Company profile specific colors
- Any custom color schemes that shouldn't use the standard pattern

## Test Dark Mode

After applying fixes:
1. Toggle dark mode in the app
2. Navigate to Suppliers module
3. Check all tabs (Dashboard, Performance, RFQ, Documents, Messages)
4. Verify status badges, buttons, and interactive elements
5. Ensure text is readable in both themes
