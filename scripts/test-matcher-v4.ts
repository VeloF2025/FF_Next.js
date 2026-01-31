import { neon } from '@neondatabase/serverless';
import { fiberDomainMatch } from '../src/services/procurement/import/fiberDomainMatcher';

const sql = neon(process.env.DATABASE_URL as string);

async function test() {
  const stockItems = (await sql`SELECT id, item_code, name, description, category FROM stock_items WHERE is_active = true`).map(r => ({
    id: r.id as string,
    itemCode: (r.item_code || '') as string,
    name: (r.name || '') as string,
    description: (r.description || '') as string,
    category: (r.category || '') as string,
  }));

  const boqItems = await sql`
    SELECT bi.id, bi.item_code, bi.description, bi.category
    FROM boq_items bi
    JOIN boqs b ON bi.boq_id = b.id
    WHERE b.title ILIKE '%Phase 2%'
    ORDER BY bi.line_number
  `;

  console.log('Stock items:', stockItems.length);
  console.log('BOQ items:', boqItems.length);

  let matched = 0;
  let unmatched = 0;
  const unmatchedByCategory: Record<string, number> = {};
  const matchedByCategory: Record<string, number> = {};
  const unmatchedSamples: Array<{desc: string, cat: string}> = [];

  for (const item of boqItems) {
    const result = fiberDomainMatch(
      { description: item.description as string, category: item.category as string, itemCode: item.item_code as string | null },
      stockItems
    );

    if (result) {
      matched++;
      const cat = (item.category as string) || 'Unknown';
      matchedByCategory[cat] = (matchedByCategory[cat] || 0) + 1;
    } else {
      unmatched++;
      const cat = (item.category as string) || 'Unknown';
      unmatchedByCategory[cat] = (unmatchedByCategory[cat] || 0) + 1;
      if (unmatchedSamples.length < 30) {
        unmatchedSamples.push({ desc: item.description as string, cat });
      }
    }
  }

  console.log('\n=== RESULTS v4 ===');
  console.log('Matched:', matched, '/', boqItems.length, '(' + Math.round(matched/boqItems.length*100) + '%)');
  console.log('Unmatched:', unmatched);

  console.log('\n=== UNMATCHED BY CATEGORY ===');
  Object.entries(unmatchedByCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => console.log('  ' + String(count).padStart(3) + 'x  ' + cat));

  console.log('\n=== MATCHED BY CATEGORY ===');
  Object.entries(matchedByCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => console.log('  ' + String(count).padStart(3) + 'x  ' + cat));

  console.log('\n=== UNMATCHED SAMPLES ===');
  unmatchedSamples.forEach(s => console.log('  [' + s.cat + '] ' + s.desc));
}

test().catch(console.error);
