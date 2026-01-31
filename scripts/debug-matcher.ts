import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL as string);

async function debug() {
  const items = await sql`SELECT item_code, name FROM stock_items WHERE is_active = true AND (
    item_code ILIKE 'STAY-%' OR
    item_code ILIKE 'CONS-SPLICEPROT%' OR
    item_code ILIKE 'ENCL-MANHOLE%' OR
    item_code ILIKE 'CONS-SLACKBRKT%' OR
    item_code ILIKE 'CONS-ALCOHOL%' OR
    item_code ILIKE 'CONS-LN%' OR
    item_code ILIKE 'CONS-CT%' OR
    item_code ILIKE 'LABEL%' OR
    item_code ILIKE 'CONDUIT-HDPE%' OR
    item_code ILIKE 'CONS-SCREW%' OR
    item_code ILIKE 'CAB-AER-SM-13%' OR
    item_code ILIKE 'CAB-TANGENT-10%' OR
    item_code ILIKE 'MICRO%' OR
    item_code ILIKE 'ELEC%'
  ) ORDER BY item_code`;

  console.log('=== Stock items for failing categories ===');
  items.forEach(i => console.log(i.item_code + ' | ' + (i.name || '')));
}
debug().catch(console.error);
