const { Client } = require('pg');

const connectionString = 'process.env.DATABASE_URL';

async function setupSearchComplete() {
    const client = new Client({ connectionString });

    try {
        console.log('🚀 FibreFlow Complete Search Setup\n');
        console.log('Connecting to Neon database...');
        await client.connect();
        console.log('✓ Connected!\n');

        // Execute everything in a transaction
        await client.query('BEGIN');
        console.log('Transaction started...\n');

        // 1. CREATE ALL TABLES
        console.log('📊 Step 1/5: Creating search tables...');
        
        const tables = [
            `CREATE TABLE IF NOT EXISTS search_synonyms (
                id SERIAL PRIMARY KEY,
                term VARCHAR(100) NOT NULL,
                synonym VARCHAR(100) NOT NULL,
                weight DECIMAL(3,2) DEFAULT 1.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(term, synonym)
            )`,
            
            `CREATE TABLE IF NOT EXISTS search_history (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255),
                search_query TEXT NOT NULL,
                search_type VARCHAR(50),
                filters_applied JSONB,
                result_count INTEGER,
                search_duration_ms INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS popular_searches (
                id SERIAL PRIMARY KEY,
                search_term VARCHAR(255) NOT NULL,
                search_count INTEGER DEFAULT 1,
                last_searched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                category VARCHAR(50),
                UNIQUE(search_term, category)
            )`,
            
            `CREATE TABLE IF NOT EXISTS filter_presets (
                id SERIAL PRIMARY KEY,
                preset_name VARCHAR(100) NOT NULL,
                preset_type VARCHAR(50) NOT NULL,
                filter_config JSONB NOT NULL,
                description TEXT,
                icon VARCHAR(50),
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(preset_name, preset_type)
            )`,
            
            `CREATE TABLE IF NOT EXISTS autocomplete_suggestions (
                id SERIAL PRIMARY KEY,
                suggestion_type VARCHAR(50) NOT NULL,
                suggestion_text VARCHAR(255) NOT NULL,
                usage_count INTEGER DEFAULT 0,
                confidence_score DECIMAL(3,2) DEFAULT 1.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(suggestion_type, suggestion_text)
            )`
        ];

        for (const sql of tables) {
            await client.query(sql);
        }
        console.log('✓ All tables created\n');

        // 2. ADD SEARCH VECTORS
        console.log('🔍 Step 2/5: Adding search vectors...');
        
        // Check and add search_vector columns
        const tablesToUpdate = ['projects', 'staff', 'clients', 'contractors'];
        for (const table of tablesToUpdate) {
            try {
                const check = await client.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_name = $1 AND column_name = 'search_vector'
                    )
                `, [table]);
                
                if (!check.rows[0].exists) {
                    await client.query(`ALTER TABLE ${table} ADD COLUMN search_vector tsvector`);
                    console.log(`  ✓ Added to ${table}`);
                }
            } catch (err) {
                // Table might not exist
            }
        }

        // Update search vectors
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
                    COALESCE(role, '')
                )
            WHERE search_vector IS NULL
        `);

        await client.query(`
            UPDATE clients SET search_vector = 
                to_tsvector('english', 
                    COALESCE(name, '') || ' ' ||
                    COALESCE(company_name, '') || ' ' ||
                    COALESCE(email, '')
                )
            WHERE search_vector IS NULL
        `);

        console.log('✓ Search vectors updated\n');

        // 3. POPULATE DATA
        console.log('📝 Step 3/5: Populating search data...');

        // Synonyms
        await client.query(`
            INSERT INTO search_synonyms (term, synonym, weight) VALUES
            ('fiber', 'fibre', 1.0),
            ('project', 'job', 0.9),
            ('install', 'installation', 1.0),
            ('cable', 'wire', 0.9),
            ('pole', 'post', 0.9),
            ('active', 'ongoing', 1.0),
            ('complete', 'completed', 1.0),
            ('complete', 'finished', 0.9),
            ('engineer', 'technician', 0.8),
            ('manager', 'supervisor', 0.9)
            ON CONFLICT DO NOTHING
        `);

        // Search history (bulk insert)
        await client.query(`
            INSERT INTO search_history (user_id, search_query, search_type, result_count, search_duration_ms, created_at)
            SELECT 
                CASE WHEN random() > 0.3 THEN 'user_' || (random() * 50)::int END,
                queries.q,
                types.t,
                (random() * 100)::int,
                (random() * 500 + 50)::int,
                CURRENT_TIMESTAMP - ((random() * 90)::int || ' days')::interval
            FROM (
                SELECT unnest(ARRAY[
                    'fiber installation', 'cable pulling', 'project status',
                    'active projects', 'testing equipment', 'safety compliance',
                    'budget report', 'team schedule', 'permit status'
                ]) as q
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
            HAVING COUNT(*) > 5
            ON CONFLICT DO NOTHING
        `);

        // Filter presets
        await client.query(`
            INSERT INTO filter_presets (preset_name, preset_type, filter_config, description, icon, sort_order) VALUES
            ('Active Projects', 'projects', '{"status": ["active"]}', 'Active projects', 'play', 1),
            ('My Projects', 'projects', '{"assigned_to": "@me"}', 'Your projects', 'user', 2),
            ('Urgent', 'projects', '{"priority": "high"}', 'High priority', 'alert', 3),
            ('Available Staff', 'staff', '{"available": true}', 'Available team', 'users', 1),
            ('Field Tech', 'staff', '{"role": "technician"}', 'Field technicians', 'tool', 2)
            ON CONFLICT DO NOTHING
        `);

        // Autocomplete
        await client.query(`
            INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, usage_count) VALUES
            ('skill', 'Fiber Splicing', 95),
            ('skill', 'OTDR Testing', 88),
            ('skill', 'Cable Pulling', 92),
            ('skill', 'Project Management', 82),
            ('location', 'Downtown', 120),
            ('location', 'North Zone', 95),
            ('location', 'South Region', 88)
            ON CONFLICT DO NOTHING
        `);

        console.log('✓ Data populated\n');

        // 4. CREATE INDEXES
        console.log('📑 Step 4/5: Creating indexes...');
        
        const indexes = [
            `CREATE INDEX IF NOT EXISTS idx_projects_search ON projects USING GIN(search_vector)`,
            `CREATE INDEX IF NOT EXISTS idx_staff_search ON staff USING GIN(search_vector)`,
            `CREATE INDEX IF NOT EXISTS idx_clients_search ON clients USING GIN(search_vector)`,
            `CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at)`,
            `CREATE INDEX IF NOT EXISTS idx_popular_searches ON popular_searches(search_count DESC)`
        ];

        for (const idx of indexes) {
            try {
                await client.query(idx);
            } catch (err) {
                // Index might exist
            }
        }
        console.log('✓ Indexes created\n');

        // 5. CREATE SEARCH FUNCTION
        console.log('🛠️ Step 5/5: Creating search function...');
        
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
                        c.name::TEXT,
                        ts_rank_cd(c.search_vector, plainto_tsquery('english', query_text))
                    FROM clients c
                    WHERE c.search_vector @@ plainto_tsquery('english', query_text)
                ) results
                ORDER BY relevance DESC
                LIMIT max_results;
            END;
            $$ LANGUAGE plpgsql
        `);
        console.log('✓ Search function created\n');

        // COMMIT
        await client.query('COMMIT');
        console.log('✅ Transaction committed!\n');

        // VERIFICATION
        console.log('=== VERIFICATION ===\n');
        
        const counts = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM search_synonyms) as synonyms,
                (SELECT COUNT(*) FROM search_history) as history,
                (SELECT COUNT(*) FROM popular_searches) as popular,
                (SELECT COUNT(*) FROM filter_presets) as presets,
                (SELECT COUNT(*) FROM autocomplete_suggestions) as suggestions
        `);
        
        const c = counts.rows[0];
        console.log('📊 Data Statistics:');
        console.log(`  • Synonyms: ${c.synonyms}`);
        console.log(`  • Search History: ${c.history}`);
        console.log(`  • Popular Searches: ${c.popular}`);
        console.log(`  • Filter Presets: ${c.presets}`);
        console.log(`  • Autocomplete: ${c.suggestions}`);

        // Test search
        console.log('\n🔎 Testing search...');
        const test = await client.query(`SELECT * FROM global_search('project', 5)`);
        console.log(`  Found ${test.rows.length} results for "project"`);

        console.log('\n' + '='.repeat(50));
        console.log('\n✨ SEARCH INFRASTRUCTURE READY! ✨\n');
        console.log('Features enabled:');
        console.log('  • Full-text search with tsvector');
        console.log('  • Search history tracking');
        console.log('  • Popular searches');
        console.log('  • Filter presets');
        console.log('  • Autocomplete suggestions');
        console.log('  • Global search function');
        console.log('\n' + '='.repeat(50));

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

setupSearchComplete().catch(console.error);