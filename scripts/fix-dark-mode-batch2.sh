#!/bin/bash
# Dark Mode Color Fix Script - Batch 2
# Converts hardcoded Tailwind colors to CSS variables
# Target directories: procurement, settings, sow

set -e

cd "$(dirname "$0")/.."

echo "🎨 Dark Mode Batch 2 Color Conversion"
echo "======================================"
echo ""

# Color conversion mappings
declare -A replacements=(
    # Background colors
    ["bg-white"]="bg-[var(--ff-bg-secondary)]"
    ["bg-gray-50"]="bg-[var(--ff-bg-tertiary)]"
    ["bg-gray-100"]="bg-[var(--ff-bg-tertiary)]"
    ["bg-gray-200"]="bg-[var(--ff-bg-hover)]"

    # Text colors
    ["text-gray-900"]="text-[var(--ff-text-primary)]"
    ["text-gray-800"]="text-[var(--ff-text-primary)]"
    ["text-gray-700"]="text-[var(--ff-text-primary)]"
    ["text-gray-600"]="text-[var(--ff-text-secondary)]"
    ["text-gray-500"]="text-[var(--ff-text-secondary)]"
    ["text-gray-400"]="text-[var(--ff-text-tertiary)]"
    ["text-gray-300"]="text-[var(--ff-text-tertiary)]"

    # Border colors
    ["border-gray-200"]="border-[var(--ff-border-light)]"
    ["border-gray-300"]="border-[var(--ff-border-light)]"

    # Hover states
    ["hover:bg-gray-50"]="hover:bg-[var(--ff-bg-hover)]"
    ["hover:bg-gray-100"]="hover:bg-[var(--ff-bg-hover)]"
    ["hover:bg-gray-200"]="hover:bg-[var(--ff-bg-hover)]"

    # Status badge colors (green)
    ["bg-green-50"]="bg-green-500/20"
    ["bg-green-100"]="bg-green-500/20"
    ["text-green-800"]="text-green-400"
    ["text-green-900"]="text-green-400"
    ["border-green-200"]="border-green-500/30"

    # Status badge colors (red)
    ["bg-red-50"]="bg-red-500/20"
    ["bg-red-100"]="bg-red-500/20"
    ["text-red-800"]="text-red-400"
    ["text-red-900"]="text-red-400"
    ["border-red-200"]="border-red-500/30"

    # Status badge colors (yellow)
    ["bg-yellow-50"]="bg-yellow-500/20"
    ["bg-yellow-100"]="bg-yellow-500/20"
    ["text-yellow-800"]="text-yellow-400"
    ["text-yellow-900"]="text-yellow-400"
    ["border-yellow-200"]="border-yellow-500/30"

    # Status badge colors (blue)
    ["bg-blue-50"]="bg-blue-500/20"
    ["bg-blue-100"]="bg-blue-500/20"
    ["text-blue-800"]="text-blue-400"
    ["text-blue-900"]="text-blue-400"
    ["border-blue-200"]="border-blue-500/30"

    # Status badge colors (orange)
    ["bg-orange-50"]="bg-orange-500/20"
    ["bg-orange-100"]="bg-orange-500/20"
    ["text-orange-800"]="text-orange-400"
    ["text-orange-900"]="text-orange-400"
    ["border-orange-200"]="border-orange-500/30"

    # Status badge colors (purple)
    ["bg-purple-50"]="bg-purple-500/20"
    ["bg-purple-100"]="bg-purple-500/20"
    ["text-purple-800"]="text-purple-400"
    ["text-purple-900"]="text-purple-400"
    ["border-purple-200"]="border-purple-500/30"
)

# Function to fix a single file
fix_file() {
    local file="$1"
    local backup="${file}.bak"

    # Skip if already has backup (already processed)
    if [[ -f "$backup" ]]; then
        echo "⏭️  Skipping (already processed): $file"
        return
    fi

    echo "🔧 Fixing: $file"

    # Create backup
    cp "$file" "$backup"

    # Apply all replacements
    for old in "${!replacements[@]}"; do
        new="${replacements[$old]}"
        # Use word boundaries to avoid partial matches
        sed -i "s/\b${old}\b/${new}/g" "$file"
    done

    echo "✅ Fixed: $file"
}

# Count files to process
total=0
for dir in src/components/{procurement,settings,sow}; do
    if [[ -d "$dir" ]]; then
        count=$(find "$dir" -name "*.tsx" -type f | wc -l)
        total=$((total + count))
    fi
done

echo "📊 Found $total TypeScript files to process"
echo ""

# Process all files
processed=0
for dir in src/components/{procurement,settings,sow}; do
    if [[ ! -d "$dir" ]]; then
        continue
    fi

    echo "📁 Processing directory: $dir"

    find "$dir" -name "*.tsx" -type f | while read file; do
        fix_file "$file"
        processed=$((processed + 1))
    done

    echo ""
done

echo "======================================"
echo "✨ Dark Mode Batch 2 Complete!"
echo "======================================"
echo ""
echo "📋 Summary:"
echo "   - Files processed: $total"
echo "   - Backup files created: *.bak"
echo ""
echo "🔍 Next Steps:"
echo "   1. Review changes: git diff"
echo "   2. Test the application"
echo "   3. If satisfied, remove backups: find src/components/{procurement,settings,sow} -name '*.bak' -delete"
echo "   4. If issues, restore: find src/components/{procurement,settings,sow} -name '*.bak' -exec bash -c 'mv \"$0\" \"${0%.bak}\"' {} \;"
echo ""
