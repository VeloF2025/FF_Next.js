#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// Database connection
const sql = neon('process.env.DATABASE_URL');

async function runMigration() {
    console.log('🚀 Starting database migration...\n');
    
    try {
        // Read the migration file
        const migrationPath = path.join(__dirname, 'migrations', 'firebase-to-neon-migration.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        // Split by semicolons but be careful with functions
        const statements = [];
        let currentStatement = '';
        let inFunction = false;
        
        const lines = migrationSQL.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Check for function/trigger definitions
            if (trimmedLine.match(/^CREATE (OR REPLACE )?(FUNCTION|TRIGGER|PROCEDURE)/i)) {
                inFunction = true;
            }
            
            currentStatement += line + '\n';
            
            // Check for end of statement
            if (inFunction) {
                if (trimmedLine.match(/^\$\$\s*(LANGUAGE|language)/i) || 
                    trimmedLine.match(/;$/)) {
                    if (trimmedLine.match(/;$/)) {
                        inFunction = false;
                        statements.push(currentStatement.trim());
                        currentStatement = '';
                    }
                }
            } else if (trimmedLine.endsWith(';') && !trimmedLine.startsWith('--')) {
                statements.push(currentStatement.trim());
                currentStatement = '';
            }
        }
        
        // Add any remaining statement
        if (currentStatement.trim()) {
            statements.push(currentStatement.trim());
        }
        
        console.log(`📋 Found ${statements.length} SQL statements to execute\n`);
        
        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;
        
        // Execute each statement
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            
            // Skip empty statements and comments
            if (!statement || statement.startsWith('--')) {
                continue;
            }
            
            // Skip DO blocks for now (they need special handling)
            if (statement.trim().startsWith('DO $$')) {
                console.log(`⏭️  Skipping DO block (${i + 1}/${statements.length})`);
                skipCount++;
                continue;
            }
            
            try {
                // Extract what type of statement this is for logging
                let statementType = 'UNKNOWN';
                if (statement.match(/^CREATE TABLE/i)) {
                    const match = statement.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i);
                    statementType = `CREATE TABLE ${match ? match[1] : ''}`;
                } else if (statement.match(/^CREATE INDEX/i)) {
                    const match = statement.match(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)/i);
                    statementType = `CREATE INDEX ${match ? match[1] : ''}`;
                } else if (statement.match(/^CREATE (?:OR REPLACE )?VIEW/i)) {
                    const match = statement.match(/CREATE (?:OR REPLACE )?VIEW (\w+)/i);
                    statementType = `CREATE VIEW ${match ? match[1] : ''}`;
                } else if (statement.match(/^CREATE (?:OR REPLACE )?FUNCTION/i)) {
                    const match = statement.match(/CREATE (?:OR REPLACE )?FUNCTION (\w+)/i);
                    statementType = `CREATE FUNCTION ${match ? match[1] : ''}`;
                } else if (statement.match(/^CREATE TRIGGER/i)) {
                    const match = statement.match(/CREATE TRIGGER (\w+)/i);
                    statementType = `CREATE TRIGGER ${match ? match[1] : ''}`;
                } else if (statement.match(/^CREATE EXTENSION/i)) {
                    const match = statement.match(/CREATE EXTENSION (?:IF NOT EXISTS )?"?(\w+)"?/i);
                    statementType = `CREATE EXTENSION ${match ? match[1] : ''}`;
                } else if (statement.match(/^ALTER TABLE/i)) {
                    const match = statement.match(/ALTER TABLE (\w+)/i);
                    statementType = `ALTER TABLE ${match ? match[1] : ''}`;
                } else if (statement.match(/^CREATE MATERIALIZED VIEW/i)) {
                    const match = statement.match(/CREATE MATERIALIZED VIEW (?:IF NOT EXISTS )?(\w+)/i);
                    statementType = `CREATE MATERIALIZED VIEW ${match ? match[1] : ''}`;
                } else if (statement.match(/^CREATE POLICY/i)) {
                    const match = statement.match(/CREATE POLICY (\w+)/i);
                    statementType = `CREATE POLICY ${match ? match[1] : ''}`;
                } else if (statement.match(/^GRANT/i)) {
                    statementType = 'GRANT permissions';
                }
                
                console.log(`⏳ Executing (${i + 1}/${statements.length}): ${statementType}...`);
                
                await sql(statement);
                
                console.log(`✅ Success: ${statementType}`);
                successCount++;
                
            } catch (error) {
                console.error(`❌ Error (${i + 1}/${statements.length}): ${error.message.substring(0, 100)}`);
                errorCount++;
                
                // Continue with next statement even if this one fails
                // (tables might already exist, etc.)
            }
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('📊 Migration Summary:');
        console.log('='.repeat(50));
        console.log(`✅ Successful: ${successCount}`);
        console.log(`⏭️  Skipped: ${skipCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log('='.repeat(50));
        
        // Check what tables were created
        console.log('\n📋 Checking created tables...\n');
        const tables = await sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `;
        
        console.log('Tables in database:');
        tables.forEach(row => console.log(`  ✓ ${row.table_name}`));
        
        console.log(`\nTotal tables: ${tables.length}`);
        
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run the migration
runMigration().catch(console.error);