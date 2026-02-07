import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL');

async function checkSchema() {
  try {
    // Check projects table columns
    const projectsCols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'projects'
      ORDER BY ordinal_position
    `;
    
    console.log('Projects table columns:');
    projectsCols.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // Check staff table columns
    const staffCols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'staff'
      ORDER BY ordinal_position
    `;
    
    console.log('\nStaff table columns:');
    staffCols.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // Check tasks table columns
    const tasksCols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tasks'
      ORDER BY ordinal_position
    `;
    
    console.log('\nTasks table columns:');
    tasksCols.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
  } catch (error) {
    console.error('Error checking schema:', error);
  }
}

checkSchema();