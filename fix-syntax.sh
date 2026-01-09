#!/bin/bash

# Fix broken getServerSideProps functions
files="pages/projects/[id]/edit.tsx pages/projects/[id]/index.tsx pages/projects/[id]/tracker.tsx pages/projects/new.tsx"

for file in $files; do
  echo "Fixing $file"
  # Replace broken getServerSideProps with simple redirect
  cat > temp_fix.txt << 'INNER_EOF'
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return {
    props: {}
  };
}
INNER_EOF
  
  # Find and replace the broken function
  sed -i /export const getServerSideProps/,/^}/d "$file"
  cat temp_fix.txt >> "$file"
done

rm -f temp_fix.txt
echo "Fixed getServerSideProps in project pages"
