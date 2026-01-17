import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log('Mapping Odoo warehouses to projects...\n');

  const warehouseMappings = [
    { code: 'Law', name: 'Lawley' },
    { code: 'Moh', name: 'Mohadin' },
    { code: 'IP', name: 'Ivory Park' },
    { code: 'MamP1', name: 'Mamelodi' },
    { code: 'GR', name: 'Grabouw' },
    { code: 'ETW', name: 'Etwatwa' },
    { code: 'Tem1', name: 'Tembisa' },
    { code: 'TBL', name: 'Tembelihle' },
  ];

  let mapped = 0;
  for (const wh of warehouseMappings) {
    const pattern = '%' + wh.name + '%';
    const result = await sql`
      UPDATE projects
      SET odoo_warehouse_code = ${wh.code}
      WHERE project_name ILIKE ${pattern}
      AND (odoo_warehouse_code IS NULL OR odoo_warehouse_code = '')
      RETURNING project_name
    `;
    if (result.length > 0) {
      mapped++;
      console.log('  Mapped ' + result[0].project_name + ' -> ' + wh.code);
    }
  }

  if (mapped === 0) {
    console.log('  (no new mappings needed or no matching projects)');
  }

  // Show all projects with mappings
  console.log('\n\nAll projects with warehouse mappings:');
  const projects = await sql`
    SELECT project_name, odoo_warehouse_code
    FROM projects
    WHERE odoo_warehouse_code IS NOT NULL
    ORDER BY project_name
  `;
  for (const p of projects) {
    const name = (p.project_name as string).padEnd(25);
    console.log('  ' + name + ' -> ' + p.odoo_warehouse_code);
  }

  console.log('\n Migration complete!');
}
run();
