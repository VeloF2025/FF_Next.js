const { Client } = require('pg');

const connectionString = 'process.env.DATABASE_URL';

async function setupSearchIndexes() {
    const client = new Client({ connectionString });

    try {
        console.log('🚀 FIBREFLOW SEARCH INDEXES SETUP\n');
        console.log('Connecting to database...');
        await client.connect();
        console.log('✓ Connected\n');

        await client.query('BEGIN');

        // 1. CREATE TABLES
        console.log('Creating search tables...');
        
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

        await client.query(`
            CREATE TABLE IF NOT EXISTS search_history (
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
            CREATE TABLE IF NOT EXISTS popular_searches (
                id SERIAL PRIMARY KEY,
                search_term VARCHAR(255) NOT NULL,
                search_count INTEGER DEFAULT 1,
                last_searched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                category VARCHAR(50),
                UNIQUE(search_term, category)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS filter_presets (
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
            CREATE TABLE IF NOT EXISTS autocomplete_suggestions (
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
            CREATE TABLE IF NOT EXISTS search_metrics (
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

        await client.query(`
            CREATE TABLE IF NOT EXISTS saved_filters (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                filter_name VARCHAR(100) NOT NULL,
                filter_type VARCHAR(50),
                filter_config JSONB NOT NULL,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, filter_name, filter_type)
            )
        `);

        console.log('✓ Tables created\n');

        // 2. ADD SEARCH VECTORS
        console.log('Adding search vectors...');
        
        // Add search_vector columns if they don't exist
        const tables = ['projects', 'staff', 'clients', 'contractors'];
        for (const table of tables) {
            try {
                const exists = await client.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = $1
                    )
                `, [table]);

                if (exists.rows[0].exists) {
                    const hasColumn = await client.query(`
                        SELECT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = $1 AND column_name = 'search_vector'
                        )
                    `, [table]);

                    if (!hasColumn.rows[0].exists) {
                        await client.query(`ALTER TABLE ${table} ADD COLUMN search_vector tsvector`);
                    }
                }
            } catch (err) {
                // Continue if table doesn't exist
            }
        }

        // Update search vectors with correct column names
        await client.query(`
            UPDATE projects SET search_vector = 
                setweight(to_tsvector('english', COALESCE(project_name, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(project_code, '')), 'B') ||
                setweight(to_tsvector('english', COALESCE(location, '')), 'B') ||
                setweight(to_tsvector('english', COALESCE(status, '')), 'C') ||
                setweight(to_tsvector('english', COALESCE(description, '')), 'D')
            WHERE search_vector IS NULL
        `);

        await client.query(`
            UPDATE staff SET search_vector = 
                setweight(to_tsvector('english', COALESCE(first_name || ' ' || last_name, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(email, '')), 'B') ||
                setweight(to_tsvector('english', COALESCE(position, '')), 'B') ||
                setweight(to_tsvector('english', COALESCE(department, '')), 'C')
            WHERE search_vector IS NULL
        `);

        await client.query(`
            UPDATE clients SET search_vector = 
                setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(company_name, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(email, '')), 'B')
            WHERE search_vector IS NULL
        `);

        console.log('✓ Search vectors updated\n');

        // 3. POPULATE SYNONYMS
        console.log('Populating search synonyms...');
        
        await client.query(`
            INSERT INTO search_synonyms (term, synonym, weight) VALUES
            ('fiber', 'fibre', 1.0),
            ('fibre', 'fiber', 1.0),
            ('project', 'job', 0.9),
            ('project', 'work', 0.8),
            ('install', 'installation', 1.0),
            ('deploy', 'deployment', 1.0),
            ('cable', 'wire', 0.9),
            ('pole', 'post', 0.9),
            ('drop', 'connection', 0.8),
            ('splice', 'joint', 0.9),
            ('test', 'testing', 1.0),
            ('active', 'ongoing', 1.0),
            ('complete', 'completed', 1.0),
            ('complete', 'finished', 0.9),
            ('pending', 'waiting', 0.9),
            ('engineer', 'technician', 0.8),
            ('manager', 'supervisor', 0.9),
            ('contractor', 'subcontractor', 0.9),
            ('site', 'location', 1.0),
            ('tool', 'equipment', 0.9)
            ON CONFLICT (term, synonym) DO NOTHING
        `);

        console.log('✓ Synonyms populated\n');

        // 4. GENERATE SEARCH HISTORY
        console.log('Generating search history...');
        
        const queries = [
            'fiber installation', 'cable pulling', 'splice closure',
            'testing equipment', 'project status', 'team schedule',
            'budget report', 'safety compliance', 'permit status',
            'quality metrics', 'milestone tracking', 'resource allocation',
            'active projects', 'pending approvals', 'equipment maintenance',
            'contractor performance', 'invoice processing', 'training certification',
            'network expansion', 'route planning', 'material requisition'
        ];

        // Generate 500+ search history entries efficiently
        for (let batch = 0; batch < 10; batch++) {
            const values = [];
            for (let i = 0; i < 60; i++) {
                const query = queries[Math.floor(Math.random() * queries.length)];
                const userId = Math.random() > 0.3 ? `user_${Math.floor(Math.random() * 50)}` : null;
                const searchType = ['global', 'projects', 'staff'][Math.floor(Math.random() * 3)];
                const resultCount = Math.floor(Math.random() * 100);
                const duration = Math.floor(Math.random() * 500 + 50);
                const daysAgo = Math.floor(Math.random() * 90);
                
                values.push(`(
                    ${userId ? `'${userId}'` : 'NULL'},
                    '${query}',
                    '${searchType}',
                    '{}',
                    ${resultCount},
                    ${duration},
                    CURRENT_TIMESTAMP - INTERVAL '${daysAgo} days'
                )`);
            }
            
            await client.query(`
                INSERT INTO search_history (user_id, search_query, search_type, filters_applied, result_count, search_duration_ms, created_at)
                VALUES ${values.join(',')}
            `);
        }

        console.log('✓ Search history generated\n');

        // 5. POPULATE POPULAR SEARCHES
        console.log('Calculating popular searches...');
        
        await client.query(`
            INSERT INTO popular_searches (search_term, search_count, category, last_searched)
            SELECT 
                search_query,
                COUNT(*)::INTEGER,
                search_type,
                MAX(created_at)
            FROM search_history
            GROUP BY search_query, search_type
            HAVING COUNT(*) > 3
            ON CONFLICT (search_term, category) DO UPDATE SET
                search_count = EXCLUDED.search_count,
                last_searched = EXCLUDED.last_searched
        `);

        console.log('✓ Popular searches calculated\n');

        // 6. POPULATE FILTER PRESETS
        console.log('Creating filter presets...');
        
        await client.query(`
            INSERT INTO filter_presets (preset_name, preset_type, filter_config, description, icon, sort_order) VALUES
            ('Active Projects', 'projects', '{"status": ["active", "in_progress"]}', 'All active projects', 'play-circle', 1),
            ('My Projects', 'projects', '{"assigned_to": "@current_user"}', 'Your assigned projects', 'user', 2),
            ('Urgent', 'projects', '{"priority": "high"}', 'High priority items', 'alert-triangle', 3),
            ('This Week', 'projects', '{"date_range": "this_week"}', 'Due this week', 'calendar', 4),
            ('Available Staff', 'staff', '{"status": "available"}', 'Available team members', 'users', 1),
            ('Technicians', 'staff', '{"position": "technician"}', 'Field technicians', 'tool', 2),
            ('Managers', 'staff', '{"position": "manager"}', 'Management team', 'briefcase', 3),
            ('Active Contractors', 'contractors', '{"status": "active"}', 'Active contractors', 'hard-hat', 1),
            ('New Clients', 'clients', '{"created": "last_30_days"}', 'Recent clients', 'user-plus', 1),
            ('VIP Clients', 'clients', '{"priority": "high"}', 'Priority clients', 'star', 2)
            ON CONFLICT (preset_name, preset_type) DO NOTHING
        `);

        console.log('✓ Filter presets created\n');

        // 7. POPULATE AUTOCOMPLETE
        console.log('Generating autocomplete suggestions...');
        
        // Skills
        const skills = [
            'Fiber Splicing', 'OTDR Testing', 'Cable Pulling', 'Fusion Splicing',
            'Network Design', 'Project Management', 'CAD Drafting', 'Safety Compliance',
            'Quality Assurance', 'Underground Construction', 'Aerial Construction',
            'Directional Drilling', 'Trenching', 'Power Meter Testing'
        ];

        for (const skill of skills) {
            await client.query(`
                INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, usage_count, confidence_score)
                VALUES ('skill', $1, $2, $3)
                ON CONFLICT (suggestion_type, suggestion_text) DO NOTHING
            `, [skill, Math.floor(Math.random() * 80 + 20), 0.85 + Math.random() * 0.15]);
        }

        // Common locations
        const locations = [
            'Downtown', 'North Zone', 'South Region', 'East District', 'West Sector',
            'Industrial Park', 'Business District', 'Residential Area', 'Rural Zone'
        ];

        for (const location of locations) {
            await client.query(`
                INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, usage_count, confidence_score)
                VALUES ('location', $1, $2, $3)
                ON CONFLICT (suggestion_type, suggestion_text) DO NOTHING
            `, [location, Math.floor(Math.random() * 100 + 30), 0.9]);
        }

        console.log('✓ Autocomplete suggestions created\n');

        // 8. CREATE INDEXES
        console.log('Creating search indexes...');
        
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_projects_search ON projects USING GIN(search_vector)',
            'CREATE INDEX IF NOT EXISTS idx_staff_search ON staff USING GIN(search_vector)',
            'CREATE INDEX IF NOT EXISTS idx_clients_search ON clients USING GIN(search_vector)',
            'CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_popular_searches ON popular_searches(search_count DESC)',
            'CREATE INDEX IF NOT EXISTS idx_autocomplete ON autocomplete_suggestions(suggestion_type, usage_count DESC)'
        ];

        for (const idx of indexes) {
            try {
                await client.query(idx);
            } catch (err) {
                // Index might exist
            }
        }

        console.log('✓ Indexes created\n');

        // 9. CREATE SEARCH FUNCTION
        console.log('Creating search function...');
        
        await client.query(`
            CREATE OR REPLACE FUNCTION global_search(
                query_text TEXT,
                max_results INTEGER DEFAULT 20
            )
            RETURNS TABLE(
                result_type TEXT,
                result_id UUID,
                result_title TEXT,
                result_description TEXT,
                relevance FLOAT
            ) AS $$
            BEGIN
                RETURN QUERY
                SELECT * FROM (
                    -- Search projects
                    SELECT 
                        'project'::TEXT,
                        p.id,
                        p.project_name::TEXT,
                        (p.location || ' - ' || p.status)::TEXT,
                        ts_rank_cd(p.search_vector, plainto_tsquery('english', query_text))
                    FROM projects p
                    WHERE p.search_vector @@ plainto_tsquery('english', query_text)
                    
                    UNION ALL
                    
                    -- Search staff
                    SELECT 
                        'staff'::TEXT,
                        s.id,
                        (s.first_name || ' ' || s.last_name)::TEXT,
                        (s.position || ' - ' || s.department)::TEXT,
                        ts_rank_cd(s.search_vector, plainto_tsquery('english', query_text))
                    FROM staff s
                    WHERE s.search_vector @@ plainto_tsquery('english', query_text)
                    
                    UNION ALL
                    
                    -- Search clients
                    SELECT 
                        'client'::TEXT,
                        c.id,
                        c.name::TEXT,
                        c.company_name::TEXT,
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

        // 10. POPULATE METRICS
        console.log('Generating search metrics...');
        
        await client.query(`
            INSERT INTO search_metrics (metric_date, search_type, total_searches, avg_duration_ms, unique_users)
            SELECT 
                date_trunc('day', created_at)::date,
                search_type,
                COUNT(*)::INTEGER,
                AVG(search_duration_ms),
                COUNT(DISTINCT user_id)::INTEGER
            FROM search_history
            GROUP BY date_trunc('day', created_at)::date, search_type
            ON CONFLICT (metric_date, search_type) DO UPDATE SET
                total_searches = EXCLUDED.total_searches,
                avg_duration_ms = EXCLUDED.avg_duration_ms
        `);

        console.log('✓ Metrics generated\n');

        // COMMIT TRANSACTION
        await client.query('COMMIT');
        console.log('✅ TRANSACTION COMMITTED\n');

        // VERIFICATION
        console.log('=== VERIFICATION ===\n');
        
        const counts = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM search_synonyms) as synonyms,
                (SELECT COUNT(*) FROM search_history) as history,
                (SELECT COUNT(*) FROM popular_searches) as popular,
                (SELECT COUNT(*) FROM filter_presets) as presets,
                (SELECT COUNT(*) FROM autocomplete_suggestions) as autocomplete,
                (SELECT COUNT(*) FROM search_metrics) as metrics
        `);
        
        const stats = counts.rows[0];
        console.log('📊 Database Statistics:');
        console.log(`  • Search Synonyms: ${stats.synonyms}`);
        console.log(`  • Search History: ${stats.history}`);
        console.log(`  • Popular Searches: ${stats.popular}`);
        console.log(`  • Filter Presets: ${stats.presets}`);
        console.log(`  • Autocomplete Suggestions: ${stats.autocomplete}`);
        console.log(`  • Search Metrics: ${stats.metrics}`);

        // Test search
        console.log('\n🔎 Testing Search Function:');
        const test = await client.query(`SELECT * FROM global_search('project', 5)`);
        console.log(`  Found ${test.rows.length} results for "project"`);
        if (test.rows.length > 0) {
            console.log('\n  Sample Results:');
            test.rows.slice(0, 3).forEach((row, i) => {
                console.log(`  ${i+1}. [${row.result_type}] ${row.result_title}`);
                console.log(`     ${row.result_description}`);
            });
        }

        console.log('\n' + '='.repeat(60));
        console.log('\n✨ SEARCH INFRASTRUCTURE SUCCESSFULLY POPULATED! ✨\n');
        console.log('Features Enabled:');
        console.log('  ✅ Full-text search with PostgreSQL tsvector');
        console.log('  ✅ Search synonyms for query expansion');
        console.log(`  ✅ ${stats.history} search history records`);
        console.log(`  ✅ ${stats.popular} popular search terms`);
        console.log(`  ✅ ${stats.presets} filter presets`);
        console.log(`  ✅ ${stats.autocomplete} autocomplete suggestions`);
        console.log('  ✅ Search performance metrics');
        console.log('  ✅ Global search function');
        console.log('\n🚀 Search system is fully operational!');
        console.log('\n' + '='.repeat(60));

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n❌ ERROR - Transaction rolled back');
        console.error('Message:', err.message);
        console.error('Detail:', err.detail || 'No additional details');
        process.exit(1);
    } finally {
        await client.end();
        console.log('\n🔒 Database connection closed.');
    }
}

// Run setup
setupSearchIndexes().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});