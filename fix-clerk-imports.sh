#\!/bin/bash
# Remove all Clerk imports and auth checks

files=$(grep -r "@clerk/nextjs" --include="*.ts" --include="*.tsx" pages/ app/ src/ 2>/dev/null | grep -v "^//" | cut -d: -f1 | sort -u)

for file in $files; do
  echo "Fixing $file"
  # Remove Clerk imports
  sed -i "/import.*@clerk\/nextjs/d" "$file"
  # Remove auth() calls
  sed -i "s/const.*auth().*//g" "$file"
  sed -i "s/getAuth(.*//g" "$file"
  # Remove auth checks
  sed -i "s/if.*\!userId.*return.*401.*//g" "$file"
  sed -i "s/if.*\!auth.*return.*401.*//g" "$file"
done

echo "Fixed $(echo "$files" | wc -l) files"
