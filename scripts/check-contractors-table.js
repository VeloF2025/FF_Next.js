#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

async function checkTable() {
  try {
    // Check contractors table structure
    const result = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'contractors'
      AND column_name = 'id'
    `;
    
    console.log('Contractors table ID column:', result);
    
    // Check if contractors table exists and get a sample
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'contractors'
      ) as exists
    `;
    
    console.log('Contractors table exists:', tableExists[0].exists);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkTable();