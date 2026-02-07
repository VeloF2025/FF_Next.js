#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');

// Database connection - uses environment variable or fallback
const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

async function runLiveKitMigration() {
    console.log('🚀 Running LiveKit migration...\n');

    try {
        // Create livekit_meetings table
        console.log('⏳ Creating livekit_meetings table...');
        await sql`
            CREATE TABLE IF NOT EXISTS livekit_meetings (
                id SERIAL PRIMARY KEY,
                room_name VARCHAR(255) UNIQUE NOT NULL,
                title VARCHAR(255),
                scheduled_at TIMESTAMP,
                started_at TIMESTAMP,
                ended_at TIMESTAMP,
                recording_path TEXT,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `;
        console.log('✅ Created livekit_meetings table');

        // Create index for room lookups
        console.log('⏳ Creating indexes...');
        await sql`
            CREATE INDEX IF NOT EXISTS idx_livekit_meetings_room_name 
            ON livekit_meetings(room_name)
        `;
        console.log('✅ Created idx_livekit_meetings_room_name');

        await sql`
            CREATE INDEX IF NOT EXISTS idx_livekit_meetings_created_at 
            ON livekit_meetings(created_at DESC)
        `;
        console.log('✅ Created idx_livekit_meetings_created_at');

        // Verify the table was created
        console.log('\n📋 Verifying migration...');
        const tables = await sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'livekit_meetings'
        `;

        if (tables.length > 0) {
            console.log('✅ Migration successful! livekit_meetings table exists.');
        } else {
            console.log('❌ Migration may have failed. Table not found.');
        }

        // Show table structure
        console.log('\n📊 Table structure:');
        const columns = await sql`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'livekit_meetings'
            ORDER BY ordinal_position
        `;
        columns.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        });

    } catch (error) {
        console.error('❌ Migration error:', error.message);
        process.exit(1);
    }
}

runLiveKitMigration().catch(console.error);
