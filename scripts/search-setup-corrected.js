const { Client } = require('pg');

const connectionString = 'process.env.DATABASE_URL';

async function setupSearchIndexes() {
    const client = new Client({ connectionString });

    try {
        console.log('🚀 FIBREFLOW SEARCH INDEXES - FINAL SETUP\n');
        await client.connect();

        // Check if we need to setup or just verify
        const check = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables 
                WHERE table_name = 'search_history'
            )
        `);

        if (check.rows[0].exists) {
            console.log('Search tables already exist. Verifying setup...\n');
        } else {
            console.log('Setting up search infrastructure...\n');
            await client.query('BEGIN');

            // CREATE ALL TABLES
            console.log('Creating tables...');
            await client.query(`
                CREATE TABLE search_synonyms (
                    id SERIAL PRIMARY KEY,
                    term VARCHAR(100) NOT NULL,
                    synonym VARCHAR(100) NOT NULL,
                    weight DECIMAL(3,2) DEFAULT 1.0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(term, synonym)
                )
            `);

            await client.query(`
                CREATE TABLE search_history (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255),
                    search_query TEXT NOT NULL,
                    search_type VARCHAR(50),
                    filters_applied JSONB,
                    result_count INTEGER,
                    search_duration_ms INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await client.query(`
                CREATE TABLE popular_searches (
                    id SERIAL PRIMARY KEY,
                    search_term VARCHAR(255) NOT NULL,
                    search_count INTEGER DEFAULT 1,
                    last_searched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    category VARCHAR(50),
                    UNIQUE(search_term, category)
                )
            `);

            await client.query(`
                CREATE TABLE filter_presets (
                    id SERIAL PRIMARY KEY,
                    preset_name VARCHAR(100) NOT NULL,
                    preset_type VARCHAR(50) NOT NULL,
                    filter_config JSONB NOT NULL,
                    description TEXT,
                    icon VARCHAR(50),
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(preset_name, preset_type)
                )
            `);

            await client.query(`
                CREATE TABLE autocomplete_suggestions (
                    id SERIAL PRIMARY KEY,
                    suggestion_type VARCHAR(50) NOT NULL,
                    suggestion_text VARCHAR(255) NOT NULL,
                    usage_count INTEGER DEFAULT 0,
                    confidence_score DECIMAL(3,2) DEFAULT 1.0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(suggestion_type, suggestion_text)
                )
            `);

            await client.query(`
                CREATE TABLE search_metrics (
                    id SERIAL PRIMARY KEY,
                    metric_date DATE NOT NULL,
                    search_type VARCHAR(50),
                    total_searches INTEGER DEFAULT 0,
                    avg_duration_ms DECIMAL(10,2),
                    unique_users INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(metric_date, search_type)
                )
            `);

            console.log('✓ Tables created\n');

            // ADD SEARCH VECTORS
            console.log('Adding search vectors...');
            
            // Projects table
            const hasProjectVector = await client.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'projects' AND column_name = 'search_vector'
                )
            `);
            if (!hasProjectVector.rows[0].exists) {
                await client.query('ALTER TABLE projects ADD COLUMN search_vector tsvector');
            }

            // Staff table
            const hasStaffVector = await client.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'staff' AND column_name = 'search_vector'
                )
            `);
            if (!hasStaffVector.rows[0].exists) {
                await client.query('ALTER TABLE staff ADD COLUMN search_vector tsvector');
            }

            // Clients table
            const hasClientVector = await client.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'clients' AND column_name = 'search_vector'
                )
            `);
            if (!hasClientVector.rows[0].exists) {
                await client.query('ALTER TABLE clients ADD COLUMN search_vector tsvector');
            }

            // Update search vectors with CORRECT column names
            await client.query(`
                UPDATE projects SET search_vector = 
                    to_tsvector('english', 
                        COALESCE(project_name, '') || ' ' ||
                        COALESCE(project_code, '') || ' ' ||
                        COALESCE(location, '') || ' ' ||
                        COALESCE(status, '')
                    )
                WHERE search_vector IS NULL
            `);

            await client.query(`
                UPDATE staff SET search_vector = 
                    to_tsvector('english', 
                        COALESCE(first_name, '') || ' ' ||
                        COALESCE(last_name, '') || ' ' ||
                        COALESCE(email, '') || ' ' ||
                        COALESCE(position, '') || ' ' ||
                        COALESCE(department, '')
                    )
                WHERE search_vector IS NULL
            `);

            await client.query(`
                UPDATE clients SET search_vector = 
                    to_tsvector('english', 
                        COALESCE(client_name, '') || ' ' ||
                        COALESCE(contact_person, '') || ' ' ||
                        COALESCE(email, '') || ' ' ||
                        COALESCE(city, '')
                    )
                WHERE search_vector IS NULL
            `);

            console.log('✓ Search vectors updated\n');

            // POPULATE DATA
            console.log('Populating data...');

            // Synonyms
            await client.query(`
                INSERT INTO search_synonyms (term, synonym, weight) VALUES
                ('fiber', 'fibre', 1.0),
                ('project', 'job', 0.9),
                ('install', 'installation', 1.0),
                ('cable', 'wire', 0.9),
                ('active', 'ongoing', 1.0),
                ('complete', 'completed', 1.0)
                ON CONFLICT DO NOTHING
            `);

            // Search history (bulk)
            await client.query(`
                INSERT INTO search_history (user_id, search_query, search_type, result_count, search_duration_ms, created_at)
                SELECT 
                    CASE WHEN random() > 0.3 THEN 'user_' || (random() * 50)::int END,
                    q || ' ' || CASE WHEN random() > 0.5 THEN 'project' ELSE 'phase ' || (random() * 5)::int END,
                    t,
                    (random() * 100)::int,
                    (random() * 500 + 50)::int,
                    CURRENT_TIMESTAMP - ((random() * 90)::int || ' days')::interval
                FROM (
                    SELECT unnest(ARRAY['fiber', 'cable', 'installation', 'testing', 'maintenance']) as q
                ) queries
                CROSS JOIN (
                    SELECT unnest(ARRAY['global', 'projects', 'staff']) as t
                ) types
                CROSS JOIN generate_series(1, 100) as n
            `);

            // Popular searches
            await client.query(`
                INSERT INTO popular_searches (search_term, search_count, category)
                SELECT search_query, COUNT(*)::int, search_type
                FROM search_history
                GROUP BY search_query, search_type
                HAVING COUNT(*) > 3
                ON CONFLICT DO NOTHING
            `);

            // Filter presets
            await client.query(`
                INSERT INTO filter_presets (preset_name, preset_type, filter_config, description, icon) VALUES
                ('Active', 'projects', '{"status": "active"}', 'Active items', 'play'),
                ('My Items', 'projects', '{"assigned": "@me"}', 'Your items', 'user'),
                ('Available', 'staff', '{"status": "available"}', 'Available staff', 'users')
                ON CONFLICT DO NOTHING
            `);

            // Autocomplete
            await client.query(`
                INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, usage_count) VALUES
                ('skill', 'Fiber Splicing', 95),
                ('skill', 'OTDR Testing', 88),
                ('location', 'Downtown', 120),
                ('location', 'North Zone', 95)
                ON CONFLICT DO NOTHING
            `);

            console.log('✓ Data populated\n');

            // Create indexes
            console.log('Creating indexes...');
            await client.query('CREATE INDEX IF NOT EXISTS idx_projects_search ON projects USING GIN(search_vector)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_staff_search ON staff USING GIN(search_vector)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_clients_search ON clients USING GIN(search_vector)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at DESC)');
            console.log('✓ Indexes created\n');

            // Create search function
            await client.query(`
                CREATE OR REPLACE FUNCTION global_search(query_text TEXT, max_results INT DEFAULT 20)
                RETURNS TABLE(
                    result_type TEXT,
                    result_id UUID,
                    result_title TEXT,
                    relevance FLOAT
                ) AS $$
                BEGIN
                    RETURN QUERY
                    SELECT * FROM (
                        SELECT 
                            'project'::TEXT,
                            p.id,
                            p.project_name::TEXT,
                            ts_rank_cd(p.search_vector, plainto_tsquery('english', query_text))
                        FROM projects p
                        WHERE p.search_vector @@ plainto_tsquery('english', query_text)
                        
                        UNION ALL
                        
                        SELECT 
                            'staff'::TEXT,
                            s.id,
                            (s.first_name || ' ' || s.last_name)::TEXT,
                            ts_rank_cd(s.search_vector, plainto_tsquery('english', query_text))
                        FROM staff s
                        WHERE s.search_vector @@ plainto_tsquery('english', query_text)
                        
                        UNION ALL
                        
                        SELECT 
                            'client'::TEXT,
                            c.id,
                            c.client_name::TEXT,
                            ts_rank_cd(c.search_vector, plainto_tsquery('english', query_text))
                        FROM clients c
                        WHERE c.search_vector @@ plainto_tsquery('english', query_text)
                    ) results
                    ORDER BY relevance DESC
                    LIMIT max_results;
                END;
                $$ LANGUAGE plpgsql
            `);

            await client.query('COMMIT');
            console.log('✅ Setup complete!\n');
        }

        // VERIFICATION
        console.log('=== VERIFICATION ===\n');
        
        const stats = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM search_synonyms) as synonyms,
                (SELECT COUNT(*) FROM search_history) as history,
                (SELECT COUNT(*) FROM popular_searches) as popular,
                (SELECT COUNT(*) FROM filter_presets) as presets,
                (SELECT COUNT(*) FROM autocomplete_suggestions) as autocomplete
        `);
        
        const s = stats.rows[0];
        console.log('📊 Statistics:');
        console.log(`  • Synonyms: ${s.synonyms}`);
        console.log(`  • History: ${s.history}`);
        console.log(`  • Popular: ${s.popular}`);
        console.log(`  • Presets: ${s.presets}`);
        console.log(`  • Autocomplete: ${s.autocomplete}`);

        // Test
        console.log('\n🔎 Testing search...');
        const test = await client.query(`SELECT * FROM global_search('project', 3)`);
        console.log(`Found ${test.rows.length} results`);

        console.log('\n✨ SEARCH SYSTEM READY! ✨');

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Error:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

setupSearchIndexes().catch(console.error);