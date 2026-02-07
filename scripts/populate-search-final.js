const { Client } = require('pg');

const connectionString = 'process.env.DATABASE_URL';

async function populateSearchIndexes() {
    const client = new Client({ connectionString });

    try {
        console.log('🚀 FibreFlow Search Index Population\n');
        console.log('Connecting to Neon database...');
        await client.connect();
        console.log('✓ Connected successfully!\n');

        // Start transaction
        await client.query('BEGIN');

        // =====================================================
        // 1. CREATE SEARCH METADATA TABLES
        // =====================================================
        console.log('📊 Creating search metadata tables...\n');
        
        // Search synonyms table
        await client.query(`
            CREATE TABLE IF NOT EXISTS search_synonyms (
                id SERIAL PRIMARY KEY,
                term VARCHAR(100) NOT NULL,
                synonym VARCHAR(100) NOT NULL,
                weight DECIMAL(3,2) DEFAULT 1.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(term, synonym)
            )
        `);

        // Search history table with indexes
        await client.query(`
            CREATE TABLE IF NOT EXISTS search_history (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255),
                search_query TEXT NOT NULL,
                search_type VARCHAR(50),
                filters_applied JSONB,
                result_count INTEGER,
                clicked_results JSONB,
                search_duration_ms INTEGER,
                session_id VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at)`);

        // Popular searches cache
        await client.query(`
            CREATE TABLE IF NOT EXISTS popular_searches (
                id SERIAL PRIMARY KEY,
                search_term VARCHAR(255) NOT NULL,
                search_count INTEGER DEFAULT 1,
                last_searched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                category VARCHAR(50),
                UNIQUE(search_term, category)
            )
        `);

        // Saved filters
        await client.query(`
            CREATE TABLE IF NOT EXISTS saved_filters (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                filter_name VARCHAR(100) NOT NULL,
                filter_type VARCHAR(50),
                filter_config JSONB NOT NULL,
                is_default BOOLEAN DEFAULT FALSE,
                usage_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, filter_name, filter_type)
            )
        `);

        // Filter presets
        await client.query(`
            CREATE TABLE IF NOT EXISTS filter_presets (
                id SERIAL PRIMARY KEY,
                preset_name VARCHAR(100) NOT NULL,
                preset_type VARCHAR(50) NOT NULL,
                filter_config JSONB NOT NULL,
                description TEXT,
                icon VARCHAR(50),
                sort_order INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(preset_name, preset_type)
            )
        `);

        // Autocomplete suggestions
        await client.query(`
            CREATE TABLE IF NOT EXISTS autocomplete_suggestions (
                id SERIAL PRIMARY KEY,
                suggestion_type VARCHAR(50) NOT NULL,
                suggestion_text VARCHAR(255) NOT NULL,
                parent_text VARCHAR(255),
                usage_count INTEGER DEFAULT 0,
                confidence_score DECIMAL(3,2) DEFAULT 1.0,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(suggestion_type, suggestion_text)
            )
        `);

        // Search metrics
        await client.query(`
            CREATE TABLE IF NOT EXISTS search_metrics (
                id SERIAL PRIMARY KEY,
                metric_date DATE NOT NULL,
                search_type VARCHAR(50),
                total_searches INTEGER DEFAULT 0,
                avg_duration_ms DECIMAL(10,2),
                failed_searches INTEGER DEFAULT 0,
                unique_users INTEGER DEFAULT 0,
                top_queries JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(metric_date, search_type)
            )
        `);

        console.log('✓ All metadata tables created\n');

        // =====================================================
        // 2. ADD SEARCH VECTORS TO EXISTING TABLES
        // =====================================================
        console.log('🔍 Adding search vectors to existing tables...\n');
        
        // Add search_vector columns
        const tablesToUpdate = [
            { name: 'projects', exists: true },
            { name: 'staff', exists: true },
            { name: 'clients', exists: true },
            { name: 'contractors', exists: true },
            { name: 'users', exists: true }
        ];

        for (const table of tablesToUpdate) {
            const columnCheck = await client.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = $1 AND column_name = 'search_vector'
                )
            `, [table.name]);

            if (!columnCheck.rows[0].exists) {
                await client.query(`ALTER TABLE ${table.name} ADD COLUMN search_vector tsvector`);
                console.log(`  ✓ Added search_vector to ${table.name}`);
            }
        }

        // =====================================================
        // 3. POPULATE SEARCH SYNONYMS
        // =====================================================
        console.log('\n📝 Populating search synonyms...\n');
        
        await client.query(`
            INSERT INTO search_synonyms (term, synonym, weight) VALUES
            -- Fiber/Fibre variations
            ('fiber', 'fibre', 1.0),
            ('fibre', 'fiber', 1.0),
            -- Project terms
            ('project', 'job', 0.9),
            ('project', 'work', 0.8),
            ('project', 'task', 0.7),
            ('install', 'installation', 1.0),
            ('deploy', 'deployment', 1.0),
            -- Network terms
            ('cable', 'wire', 0.9),
            ('pole', 'post', 0.9),
            ('drop', 'connection', 0.8),
            ('splice', 'joint', 0.9),
            ('test', 'testing', 1.0),
            -- Status terms
            ('active', 'ongoing', 1.0),
            ('active', 'in progress', 0.9),
            ('complete', 'completed', 1.0),
            ('complete', 'finished', 0.9),
            ('complete', 'done', 0.8),
            ('pending', 'waiting', 0.9),
            ('pending', 'on hold', 0.8),
            -- Staff terms
            ('engineer', 'technician', 0.8),
            ('manager', 'supervisor', 0.9),
            ('lead', 'senior', 0.9),
            ('contractor', 'subcontractor', 0.9),
            ('team', 'crew', 0.9),
            -- Location terms
            ('site', 'location', 1.0),
            ('area', 'region', 0.9),
            ('zone', 'sector', 0.9),
            -- Equipment terms
            ('tool', 'equipment', 0.9),
            ('vehicle', 'truck', 0.8),
            ('otdr', 'optical time domain reflectometer', 1.0),
            ('meter', 'power meter', 0.9)
            ON CONFLICT (term, synonym) DO NOTHING
        `);

        const synonymCount = await client.query('SELECT COUNT(*) FROM search_synonyms');
        console.log(`  ✓ Created ${synonymCount.rows[0].count} synonyms\n`);

        // =====================================================
        // 4. GENERATE SEARCH HISTORY (BULK INSERT)
        // =====================================================
        console.log('📈 Generating search history...\n');
        
        // Use generate_series for efficient bulk insert
        await client.query(`
            INSERT INTO search_history (user_id, search_query, search_type, result_count, search_duration_ms, created_at, filters_applied)
            SELECT 
                CASE WHEN random() > 0.3 THEN 'user_' || (random() * 50)::int ELSE NULL END,
                queries.q,
                types.t,
                (random() * 100)::int,
                (random() * 500 + 50)::int,
                CURRENT_TIMESTAMP - ((random() * 90)::int || ' days')::interval,
                json_build_object(
                    'status', CASE WHEN random() > 0.5 THEN 'active' ELSE NULL END,
                    'date_range', CASE WHEN random() > 0.5 THEN 'last_30_days' ELSE 'all_time' END
                )::jsonb
            FROM (
                SELECT unnest(ARRAY[
                    'fiber installation downtown', 'pole inspection route 5', 'drop connections phase 2',
                    'splice enclosure inventory', 'technician availability', 'project status update',
                    'cable pulling team', 'testing equipment', 'safety compliance report',
                    'contractor performance', 'budget variance', 'milestone completion',
                    'active projects', 'pending approvals', 'equipment maintenance',
                    'quality assurance', 'permit status', 'route planning',
                    'workforce allocation', 'material requisition', 'invoice processing',
                    'training certification', 'emergency response', 'weather delays',
                    'customer installations', 'network expansion', 'backbone infrastructure',
                    'last mile connectivity', 'rural deployment', 'urban density',
                    'fiber optic specs', 'trenching requirements', 'aerial installation',
                    'underground conduit', 'right of way', 'environmental assessment',
                    'project timeline', 'resource utilization', 'cost analysis',
                    'risk mitigation', 'stakeholder communication', 'change orders',
                    'quality metrics', 'performance KPI', 'service agreements'
                ]) as q
            ) queries
            CROSS JOIN (
                SELECT unnest(ARRAY['global', 'projects', 'staff', 'contractors']) as t
            ) types
            CROSS JOIN generate_series(1, 15) as n
        `);

        const historyCount = await client.query('SELECT COUNT(*) FROM search_history');
        console.log(`  ✓ Generated ${historyCount.rows[0].count} search history entries\n`);

        // =====================================================
        // 5. POPULATE POPULAR SEARCHES
        // =====================================================
        console.log('🔥 Calculating popular searches...\n');
        
        await client.query(`
            INSERT INTO popular_searches (search_term, search_count, category, last_searched)
            SELECT 
                search_query,
                COUNT(*)::INTEGER,
                search_type,
                MAX(created_at)
            FROM search_history
            GROUP BY search_query, search_type
            HAVING COUNT(*) > 5
            ON CONFLICT (search_term, category) DO UPDATE SET
                search_count = EXCLUDED.search_count,
                last_searched = EXCLUDED.last_searched
        `);

        const popularCount = await client.query('SELECT COUNT(*) FROM popular_searches');
        console.log(`  ✓ Created ${popularCount.rows[0].count} popular searches\n`);

        // =====================================================
        // 6. POPULATE FILTER PRESETS
        // =====================================================
        console.log('⚙️ Creating filter presets...\n');
        
        await client.query(`
            INSERT INTO filter_presets (preset_name, preset_type, filter_config, description, icon, sort_order) VALUES
            -- Project filters
            ('Active Projects', 'projects', '{"status": ["active", "in_progress"]}', 'Show all active projects', 'play-circle', 1),
            ('My Projects', 'projects', '{"assigned_to": "@current_user"}', 'Your assigned projects', 'user', 2),
            ('Urgent Projects', 'projects', '{"priority": "high", "deadline": "next_7_days"}', 'High priority projects', 'alert-triangle', 3),
            ('Recent Projects', 'projects', '{"created": "last_30_days"}', 'Recently created projects', 'clock', 4),
            ('Overdue Projects', 'projects', '{"status": "active", "end_date": "overdue"}', 'Projects past deadline', 'alert', 5),
            -- Staff filters
            ('Available Staff', 'staff', '{"availability": "available"}', 'Available team members', 'users', 1),
            ('Field Technicians', 'staff', '{"role": ["technician", "field_tech"]}', 'Field technical staff', 'tool', 2),
            ('Project Managers', 'staff', '{"role": "project_manager"}', 'Project management team', 'briefcase', 3),
            ('Contractors', 'contractors', '{"status": "active"}', 'Active contractors', 'hard-hat', 1),
            ('Top Rated', 'contractors', '{"rating": ">4"}', 'Highly rated contractors', 'star', 2)
            ON CONFLICT (preset_name, preset_type) DO NOTHING
        `);

        const presetCount = await client.query('SELECT COUNT(*) FROM filter_presets');
        console.log(`  ✓ Created ${presetCount.rows[0].count} filter presets\n`);

        // =====================================================
        // 7. POPULATE AUTOCOMPLETE SUGGESTIONS
        // =====================================================
        console.log('💡 Generating autocomplete suggestions...\n');

        // Get existing project names for suggestions
        const projectNames = await client.query('SELECT DISTINCT name FROM projects WHERE name IS NOT NULL LIMIT 100');
        for (const row of projectNames.rows) {
            await client.query(`
                INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, usage_count, confidence_score)
                VALUES ('project_name', $1, $2, 0.95)
                ON CONFLICT (suggestion_type, suggestion_text) DO NOTHING
            `, [row.name, Math.floor(Math.random() * 50 + 10)]);
        }

        // Add skill suggestions
        const skills = [
            'Fiber Splicing', 'OTDR Testing', 'Cable Pulling', 'Fusion Splicing',
            'Network Design', 'Project Management', 'CAD Drafting', 'Permit Acquisition',
            'Quality Assurance', 'Safety Compliance', 'Underground Construction',
            'Aerial Construction', 'Directional Drilling', 'Trenching', 'Restoration'
        ];
        
        for (const skill of skills) {
            await client.query(`
                INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, usage_count, confidence_score)
                VALUES ('staff_skill', $1, $2, $3)
                ON CONFLICT DO NOTHING
            `, [skill, Math.floor(Math.random() * 80 + 20), 0.9 + Math.random() * 0.1]);
        }

        // Add location suggestions from existing data
        const locations = await client.query('SELECT DISTINCT location FROM projects WHERE location IS NOT NULL LIMIT 50');
        for (const row of locations.rows) {
            await client.query(`
                INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, usage_count, confidence_score)
                VALUES ('location', $1, $2, 0.9)
                ON CONFLICT DO NOTHING
            `, [row.location, Math.floor(Math.random() * 100 + 10)]);
        }

        const suggestCount = await client.query('SELECT COUNT(*) FROM autocomplete_suggestions');
        console.log(`  ✓ Created ${suggestCount.rows[0].count} autocomplete suggestions\n`);

        // =====================================================
        // 8. UPDATE SEARCH VECTORS
        // =====================================================
        console.log('🔄 Updating search vectors on existing records...\n');

        // Update projects
        await client.query(`
            UPDATE projects SET search_vector = 
                setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(client_name, '')), 'B') ||
                setweight(to_tsvector('english', COALESCE(location, '')), 'B') ||
                setweight(to_tsvector('english', COALESCE(status, '')), 'C')
            WHERE search_vector IS NULL
        `);

        // Update staff
        await client.query(`
            UPDATE staff SET search_vector = 
                setweight(to_tsvector('english', COALESCE(first_name || ' ' || last_name, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(email, '')), 'B') ||
                setweight(to_tsvector('english', COALESCE(role, '')), 'B') ||
                setweight(to_tsvector('english', COALESCE(department, '')), 'C')
            WHERE search_vector IS NULL
        `);

        // Update clients
        await client.query(`
            UPDATE clients SET search_vector = 
                setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(company_name, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(email, '')), 'B')
            WHERE search_vector IS NULL
        `);

        console.log('  ✓ Search vectors updated\n');

        // =====================================================
        // 9. CREATE SEARCH INDEXES
        // =====================================================
        console.log('📑 Creating search indexes...\n');

        const indexes = [
            `CREATE INDEX IF NOT EXISTS idx_projects_search ON projects USING GIN(search_vector)`,
            `CREATE INDEX IF NOT EXISTS idx_staff_search ON staff USING GIN(search_vector)`,
            `CREATE INDEX IF NOT EXISTS idx_clients_search ON clients USING GIN(search_vector)`,
            `CREATE INDEX IF NOT EXISTS idx_search_history_query_gin ON search_history USING GIN(to_tsvector('english', search_query))`,
            `CREATE INDEX IF NOT EXISTS idx_autocomplete_text ON autocomplete_suggestions(suggestion_type, suggestion_text)`
        ];

        for (const idx of indexes) {
            try {
                await client.query(idx);
            } catch (err) {
                // Index might already exist
            }
        }
        console.log('  ✓ Search indexes created\n');

        // =====================================================
        // 10. CREATE SEARCH FUNCTIONS
        // =====================================================
        console.log('🛠️ Creating search functions...\n');

        await client.query(`
            CREATE OR REPLACE FUNCTION global_search(
                query_text TEXT,
                max_results INTEGER DEFAULT 20
            )
            RETURNS TABLE(
                result_type TEXT,
                result_id INTEGER,
                result_title TEXT,
                relevance FLOAT,
                snippet TEXT
            ) AS $$
            BEGIN
                RETURN QUERY
                SELECT * FROM (
                    -- Search projects
                    SELECT 
                        'project'::TEXT,
                        p.id,
                        p.name::TEXT,
                        ts_rank_cd(p.search_vector, plainto_tsquery('english', query_text)),
                        ts_headline('english', COALESCE(p.name, ''), plainto_tsquery('english', query_text))::TEXT
                    FROM projects p
                    WHERE p.search_vector @@ plainto_tsquery('english', query_text)
                    
                    UNION ALL
                    
                    -- Search staff
                    SELECT 
                        'staff'::TEXT,
                        s.id,
                        (s.first_name || ' ' || s.last_name)::TEXT,
                        ts_rank_cd(s.search_vector, plainto_tsquery('english', query_text)),
                        ts_headline('english', COALESCE(s.first_name || ' ' || s.last_name, ''), plainto_tsquery('english', query_text))::TEXT
                    FROM staff s
                    WHERE s.search_vector @@ plainto_tsquery('english', query_text)
                    
                    UNION ALL
                    
                    -- Search clients
                    SELECT 
                        'client'::TEXT,
                        c.id,
                        c.name::TEXT,
                        ts_rank_cd(c.search_vector, plainto_tsquery('english', query_text)),
                        ts_headline('english', COALESCE(c.name, ''), plainto_tsquery('english', query_text))::TEXT
                    FROM clients c
                    WHERE c.search_vector @@ plainto_tsquery('english', query_text)
                ) results
                ORDER BY relevance DESC
                LIMIT max_results;
            END;
            $$ LANGUAGE plpgsql
        `);

        console.log('  ✓ Search functions created\n');

        // =====================================================
        // COMMIT TRANSACTION
        // =====================================================
        await client.query('COMMIT');
        console.log('✅ Transaction committed successfully!\n');

        // =====================================================
        // VERIFICATION
        // =====================================================
        console.log('=== VERIFICATION ===\n');
        
        const tables = [
            'search_synonyms',
            'search_history',
            'popular_searches',
            'filter_presets',
            'autocomplete_suggestions',
            'saved_filters',
            'search_metrics'
        ];

        for (const table of tables) {
            const result = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
            console.log(`  ${table}: ${result.rows[0].count} records`);
        }

        // Test search
        console.log('\n🔎 Testing search functionality...\n');
        const searchResult = await client.query(`SELECT * FROM global_search('project', 5)`);
        console.log(`  Global search test: ${searchResult.rows.length} results found`);
        
        if (searchResult.rows.length > 0) {
            console.log('\n  Sample results:');
            searchResult.rows.forEach((row, i) => {
                console.log(`    ${i+1}. [${row.result_type}] ${row.result_title}`);
            });
        }

        console.log('\n' + '='.repeat(50));
        console.log('\n✨ SEARCH INFRASTRUCTURE SUCCESSFULLY POPULATED! ✨\n');
        console.log('Available features:');
        console.log('  • Full-text search with PostgreSQL tsvector');
        console.log('  • Search synonyms and query expansion');
        console.log('  • ${historyCount.rows[0].count} search history records');
        console.log('  • ${popularCount.rows[0].count} popular search terms');
        console.log('  • ${presetCount.rows[0].count} filter presets');
        console.log('  • ${suggestCount.rows[0].count} autocomplete suggestions');
        console.log('  • Global search function across multiple tables');
        console.log('  • Optimized GIN indexes for fast searching');
        console.log('\n' + '='.repeat(50));

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error occurred, transaction rolled back:', err.message);
        console.error(err.stack);
        process.exit(1);
    } finally {
        await client.end();
        console.log('\n🔒 Database connection closed.');
    }
}

// Run the script
console.clear();
populateSearchIndexes().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});