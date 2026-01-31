import { neon } from '@neondatabase/serverless';
import { fiberDomainMatch } from '../src/services/procurement/import/fiberDomainMatcher';

const sql = neon(process.env.DATABASE_URL as string);

async function debug() {
  const stockItems = (await sql`SELECT id, item_code, name, description, category FROM stock_items WHERE is_active = true`).map(r => ({
    id: r.id as string,
    itemCode: (r.item_code || '') as string,
    name: (r.name || '') as string,
    description: (r.description || '') as string,
    category: (r.category || '') as string,
  }));

  // Get actual unmatched BOQ items from DB
  const failingCats = [
    'Stay Set', 'Splice Protector', 'Lock Nut (Galv)',
    'Access Chamber (Manhole)', 'Access Chamber (Manhole Key)',
    'Tangent (ADSS)', 'Slack Bracket (Slack Storage Box)',
    'Alcohol (Aerosol)', 'Label (Brady)', 'Screw',
    'Micro Duct (HDPE, Polyethylene)', 'Electrical', 'Conduit (HDPE)',
    'Cable Tie', 'Aerial Cable (ADSS Slimline)', 'Power Cable Kit'
  ];

  const boqItems = await sql`
    SELECT DISTINCT bi.description, bi.category, bi.item_code
    FROM boq_items bi
    JOIN boqs b ON bi.boq_id = b.id
    WHERE b.title ILIKE '%Phase 2%'
    ORDER BY bi.category, bi.description
  `;

  for (const cat of failingCats) {
    const items = boqItems.filter(b => b.category === cat);
    if (items.length === 0) continue;

    console.log(`\n=== ${cat} (${items.length} unique descriptions) ===`);
    for (const item of items) {
      const result = fiberDomainMatch(
        { description: item.description as string, category: item.category as string, itemCode: item.item_code as string | null },
        stockItems
      );
      const status = result ? `✅ → ${result.stockItem.itemCode} (${result.score.toFixed(2)})` : '❌ NO MATCH';
      console.log(`  ${status}  "${item.description}"`);
    }
  }
}
debug().catch(console.error);
