/**
 * Migration 109: Add stakeholder approval types for Smartsheet sync
 */

const { neon } = require('@neondatabase/serverless');

async function runMigration() {
  const sql = neon(process.env.DATABASE_URL);

  console.log('Running migration 109: Pipeline stakeholder types...');

  // Telecom/Fibre providers
  const telecomTypes = [
    ['wayleave_cell_c', 'Wayleave - Cell C', 'wayleave', 'Cell C mobile network crossing approval', 20],
    ['wayleave_dfa', 'Wayleave - DFA', 'wayleave', 'Dark Fibre Africa crossing approval', 21],
    ['wayleave_frogfoot', 'Wayleave - Frogfoot', 'wayleave', 'Frogfoot Networks crossing approval', 22],
    ['wayleave_ict', 'Wayleave - ICT', 'wayleave', 'ICT infrastructure crossing approval', 23],
    ['wayleave_link_africa', 'Wayleave - Link Africa', 'wayleave', 'Link Africa crossing approval', 24],
    ['wayleave_liquid', 'Wayleave - Liquid', 'wayleave', 'Liquid Intelligent Technologies crossing approval', 25],
    ['wayleave_metro_fibre', 'Wayleave - Metro Fibre', 'wayleave', 'Metro Fibre Networx crossing approval', 26],
    ['wayleave_mtc', 'Wayleave - MTC', 'wayleave', 'MTC crossing approval', 27],
    ['wayleave_mtn', 'Wayleave - MTN', 'wayleave', 'MTN network crossing approval', 28],
    ['wayleave_open_serve', 'Wayleave - Open Serve', 'wayleave', 'Open Serve (Telkom) crossing approval', 29],
    ['wayleave_seacom', 'Wayleave - Seacom', 'wayleave', 'Seacom submarine cable crossing approval', 30],
    ['wayleave_vodacom', 'Wayleave - Vodacom', 'wayleave', 'Vodacom network crossing approval', 31],
    ['wayleave_vumatel', 'Wayleave - Vumatel', 'wayleave', 'Vumatel fibre crossing approval', 32],
  ];

  // Utilities
  const utilityTypes = [
    ['wayleave_city_power', 'Wayleave - City Power', 'wayleave', 'City Power (Johannesburg) electricity crossing', 40],
    ['wayleave_city_parks', 'Wayleave - City Parks', 'wayleave', 'City Parks tree/green space approval', 41],
    ['wayleave_egoli_gas', 'Wayleave - Egoli Gas', 'wayleave', 'Egoli Gas pipeline crossing approval', 42],
    ['wayleave_rand_water', 'Wayleave - Rand Water', 'wayleave', 'Rand Water pipeline crossing approval', 43],
    ['wayleave_sasol', 'Wayleave - Sasol', 'wayleave', 'Sasol gas pipeline crossing approval', 44],
    ['wayleave_air_products', 'Wayleave - Air Products', 'wayleave', 'Air Products pipeline crossing approval', 45],
  ];

  // Municipal
  const municipalTypes = [
    ['municipal_jra', 'JRA - Johannesburg Roads Agency', 'municipal', 'Johannesburg Roads Agency road crossing approval', 50],
    ['municipal_ekurhuleni_roads', 'Ekurhuleni Roads', 'municipal', 'Ekurhuleni Metropolitan Municipality roads approval', 51],
    ['municipal_ekurhuleni_electricity', 'Ekurhuleni Electricity', 'municipal', 'Ekurhuleni electricity infrastructure crossing', 52],
    ['municipal_ekurhuleni_water', 'Ekurhuleni Water & Sewer', 'municipal', 'Ekurhuleni water and sewer crossing approval', 53],
    ['municipal_cot_electricity', 'COT Electricity', 'municipal', 'City of Tshwane electricity crossing', 54],
    ['municipal_cot_water', 'COT Water & Sanitation', 'municipal', 'City of Tshwane water crossing', 55],
    ['municipal_cot_stormwater', 'COT Stormwater', 'municipal', 'City of Tshwane stormwater infrastructure', 56],
    ['municipal_cot_forestry', 'COT Urban Forestry', 'municipal', 'City of Tshwane tree/forestry approval', 57],
    ['municipal_jhb_water', 'Johannesburg Water', 'municipal', 'Johannesburg Water crossing approval', 58],
    ['municipal_buffalo_city', 'Buffalo City Municipality', 'municipal', 'Buffalo City Metropolitan approval', 59],
  ];

  const allTypes = [...telecomTypes, ...utilityTypes, ...municipalTypes];

  let inserted = 0;
  for (const [code, name, category, description, displayOrder] of allTypes) {
    try {
      await sql`
        INSERT INTO pipeline_approval_types (code, name, category, description, default_required, is_active, display_order)
        VALUES (${code}, ${name}, ${category}, ${description}, false, true, ${displayOrder})
        ON CONFLICT (code) DO NOTHING
      `;
      inserted++;
    } catch (e) {
      console.error(`Error inserting ${code}:`, e.message);
    }
  }

  // Verify
  const types = await sql`SELECT code, name FROM pipeline_approval_types WHERE is_active = true ORDER BY display_order`;
  console.log(`\nMigration complete. Inserted ${inserted} types.`);
  console.log(`Total active approval types: ${types.length}`);

  // Show new types
  console.log('\nNew stakeholder types added:');
  const newCodes = allTypes.map(t => t[0]);
  types.filter(t => newCodes.includes(t.code)).forEach(t => console.log(`  ✓ ${t.code}: ${t.name}`));
}

runMigration().catch(console.error);
