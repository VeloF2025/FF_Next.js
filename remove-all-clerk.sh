#\!/bin/bash

echo "Removing ALL Clerk/auth references..."

# Find all files with Clerk/auth references
files=$(grep -r "clerk\|getAuth\|userId\|auth()" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" . 2>/dev/null | grep -v node_modules | grep -v ".next" | cut -d: -f1 | sort -u)

for file in $files; do
  echo "Cleaning $file"
  
  # Remove import lines
  sed -i "/import.*clerk/Id" "$file"
  sed -i "/import.*getAuth/d" "$file"
  sed -i "/import.*auth.*from/d" "$file"
  
  # Remove auth check blocks
  sed -i "/const.*userId.*=/,+5d" "$file"
  sed -i "/const.*auth.*=/,+5d" "$file"
  sed -i "/if.*\!userId/,+3d" "$file"
  sed -i "/if.*\!auth/,+3d" "$file"
  
  # Remove standalone auth lines
  sed -i "/getAuth(/d" "$file"
  sed -i "/auth()/d" "$file"
  sed -i "/userId/d" "$file"
  
  # Remove Clerk components
  sed -i "/<ClerkProvider/,/<\/ClerkProvider>/d" "$file"
  sed -i "/<SignIn/d" "$file"
  sed -i "/<SignUp/d" "$file"
  sed -i "/<UserButton/d" "$file"
done

# Delete auth-related files
rm -f src/services/auth/clerkAuth.ts
rm -f src/components/layout/ClerkHeader.tsx  
rm -f app/sign-in/\*/\*.tsx
rm -f app/sign-up/\*/\*.tsx
rm -rf app/sign-in app/sign-up

echo "Removed references from $(echo "$files" | wc -l) files"
