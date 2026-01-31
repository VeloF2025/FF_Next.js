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

  // Test specific failing descriptions
  const testCases = [
    // Tangent - 2 unmatched
    { desc: 'Tangent.ADSS10.80-11.49mm', cat: 'Tangent (ADSS)', expected: 'CAB-TANGENT-10.80-11.49' },
    // Splice Protector - 8 unmatched
    { desc: 'Splice Protector.40mm.1.3mm.12F', cat: 'Splice Protector', expected: 'CONS-SPLICEPROT-40-1.3' },
    { desc: 'Splice Protector.60mm.3mm.48F', cat: 'Splice Protector', expected: 'CONS-SPLICEPROT-60-3' },
    // Lock Nut - 8 unmatched
    { desc: 'Lock Nut.Galv.M12', cat: 'Lock Nut (Galv)', expected: 'STAY-NUT-M12' },
    { desc: 'Lock Nut.Galv.M14', cat: 'Lock Nut (Galv)', expected: 'STAY-NUT-M14' },
    // Cable Tie - check if matched
    { desc: 'Cable Tie.Large', cat: 'Cable Tie', expected: 'CONS-CT-L' },
    { desc: 'Cable Tie.Small', cat: 'Cable Tie', expected: 'CONS-CT-S' },
    // Alcohol - 2 unmatched
    { desc: 'Alcohol.Aerosol.500ml', cat: 'Alcohol (Aerosol)', expected: 'CONS-ALCOHOL-SPRAY' },
    // Label (Brady) - 6 unmatched
    { desc: 'Label.Brady.25mm.Yellow Carrier', cat: 'Label (Brady)', expected: '???' },
    // Screw - 4 unmatched
    { desc: 'Screw.Coach.12x100mm', cat: 'Screw', expected: 'CONS-SCREW' },
    // Access Chamber Manhole - 4 unmatched
    { desc: 'Access Chamber.Manhole.RN400 Extension', cat: 'Access Chamber (Manhole)', expected: 'ENCL-MANHOLE-RN400-EXT' },
    { desc: 'Access Chamber.Manhole.RN900', cat: 'Access Chamber (Manhole)', expected: 'ENCL-MANHOLE-RN900???' },
    // Stay Set - 16 unmatched
    { desc: 'Stay Set.BOTTOM MAKEOFF 7/2mm', cat: 'Stay Set', expected: 'STAY-BOTTOM-MAKEOFF-7-2' },
    { desc: 'Stay Set.WRAP GUY GRIP 7/2mm', cat: 'Stay Set', expected: 'STAY-GUYGRIP-7-2' },
    { desc: 'Stay Set.STAYWIRE 7/2mm x 100m', cat: 'Stay Set', expected: 'STAY-WIRE-7-2-100' },
    { desc: 'Stay Set.Non ADJ C/W BASE fro M12', cat: 'Stay Set', expected: 'STAY-CW-BASE+ROD-M12' },
    { desc: 'M12 Nuts Bolts and Washers Assembly', cat: 'Stay Set', expected: 'STAY-NBW-M12' },
    // Slack Storage Box
    { desc: 'Slack Bracket.Slack Storage Box.15m', cat: 'Slack Bracket (Slack Storage Box)', expected: '???' },
    // Micro Duct - 10 unmatched
    { desc: 'Micro Duct.HDPE.7/3.5mm', cat: 'Micro Duct (HDPE, Polyethylene)', expected: 'MICRO-???' },
    // Electrical - 10 unmatched
    { desc: 'Electrical.MCB 20A', cat: 'Electrical', expected: 'ELEC-???' },
    // Conduit HDPE - 4 unmatched
    { desc: 'Conduit.HDPE.40mm.50m', cat: 'Conduit (HDPE)', expected: 'CONDUIT-HDPE-???' },
  ];

  for (const tc of testCases) {
    const result = fiberDomainMatch(
      { description: tc.desc, category: tc.cat, itemCode: null },
      stockItems
    );

    if (result) {
      console.log(`✅ [${tc.cat}] "${tc.desc}" → ${result.stockItem.itemCode} (${result.score.toFixed(2)})`);
    } else {
      console.log(`❌ [${tc.cat}] "${tc.desc}" → NO MATCH (expected: ${tc.expected})`);
    }
  }
}
debug().catch(console.error);
