const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

async function checkProjects() {
  try {
    console.log('Checking projects in Neon database...\n');
    
    // Check if projects table exists
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'projects'
    `;
    
    if (tables.length === 0) {
      console.log('❌ Projects table does not exist!');
      return;
    }
    
    console.log('✅ Projects table exists');
    
    // Count projects
    const countResult = await sql`SELECT COUNT(*) as count FROM projects`;
    console.log(`\n📊 Total projects: ${countResult[0].count}`);
    
    // Get project details
    const projects = await sql`
      SELECT 
        p.id,
        p.name,
        p.status,
        p.client_id,
        c.name as client_name,
        p.created_at
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      ORDER BY p.created_at DESC
      LIMIT 10
    `;
    
    if (projects.length > 0) {
      console.log('\n📋 Recent projects:');
      projects.forEach(p => {
        console.log(`  - ${p.name} (${p.status}) - Client: ${p.client_name || 'N/A'}`);
      });
    } else {
      console.log('\n⚠️  No projects found in database');
      
      // Check clients table
      const clientCount = await sql`SELECT COUNT(*) as count FROM clients`;
      console.log(`\n📊 Total clients: ${clientCount[0].count}`);
      
      if (clientCount[0].count === 0) {
        console.log('\n💡 No clients found either. Let\'s add sample data...');
        
        // Add a sample client
        const client = await sql`
          INSERT INTO clients (id, name, email, phone, status, created_at)
          VALUES (
            gen_random_uuid(),
            'Sample Client Corp',
            'contact@sampleclient.com',
            '+1234567890',
            'active',
            NOW()
          )
          RETURNING id, name
        `;
        
        console.log(`✅ Created client: ${client[0].name}`);
        
        // Add sample projects
        const projectsToAdd = [
          { name: 'Fiber Network Expansion - Phase 1', status: 'active', budget: 250000 },
          { name: 'Downtown Infrastructure Upgrade', status: 'in_progress', budget: 180000 },
          { name: 'Rural Connectivity Project', status: 'planning', budget: 320000 }
        ];
        
        for (const proj of projectsToAdd) {
          const project = await sql`
            INSERT INTO projects (
              id, name, client_id, status, budget, 
              start_date, end_date, created_at
            )
            VALUES (
              gen_random_uuid(),
              ${proj.name},
              ${client[0].id},
              ${proj.status},
              ${proj.budget},
              CURRENT_DATE,
              CURRENT_DATE + INTERVAL '6 months',
              NOW()
            )
            RETURNING name, status
          `;
          console.log(`✅ Created project: ${project[0].name} (${project[0].status})`);
        }
      }
    }
    
    // Check the column that's causing issues
    console.log('\n🔍 Checking clients table structure:');
    const clientColumns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'clients' 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `;
    
    console.log('Client table columns:');
    clientColumns.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type})`);
    });
    
  } catch (error) {
    console.error('Error checking projects:', error);
  } finally {
    process.exit(0);
  }
}

checkProjects();