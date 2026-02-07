const { Client } = require('pg');

const connectionString = 'process.env.DATABASE_URL';

async function populateSearchIndexes() {
    const client = new Client({ connectionString });

    try {
        console.log('Connecting to database...');
        await client.connect();
        console.log('Connected successfully!\n');

        // Start transaction
        await client.query('BEGIN');
        console.log('Starting transaction...\n');

        // 1. CREATE SEARCH METADATA TABLES
        console.log('1. Creating search metadata tables...');
        
        // Create search_synonyms table
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
        console.log('   ✓ search_synonyms table created');

        // Create search_history table
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
                ip_address VARCHAR(45),
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create indexes for search_history
        await client.query(`CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_search_history_query ON search_history USING GIN(to_tsvector('english', search_query))`);
        console.log('   ✓ search_history table created');

        // Create popular_searches table
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
        console.log('   ✓ popular_searches table created');

        // Create saved_filters table
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
        console.log('   ✓ saved_filters table created');

        // Create filter_presets table
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
        console.log('   ✓ filter_presets table created');

        // Create autocomplete_suggestions table
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
        console.log('   ✓ autocomplete_suggestions table created');

        // Create search_metrics table
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
        console.log('   ✓ search_metrics table created');

        // 2. ADD SEARCH VECTOR COLUMNS TO MAIN TABLES
        console.log('\n2. Adding search vectors to main tables...');
        
        const tables = ['projects', 'staff', 'contractors', 'clients', 'equipment'];
        for (const table of tables) {
            try {
                // Check if table exists
                const tableExists = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = $1
                    )
                `, [table]);
                
                if (tableExists.rows[0].exists) {
                    // Check if column exists
                    const columnExists = await client.query(`
                        SELECT EXISTS (
                            SELECT FROM information_schema.columns 
                            WHERE table_schema = 'public' 
                            AND table_name = $1 
                            AND column_name = 'search_vector'
                        )
                    `, [table]);
                    
                    if (!columnExists.rows[0].exists) {
                        await client.query(`ALTER TABLE ${table} ADD COLUMN search_vector tsvector`);
                        console.log(`   ✓ Added search_vector to ${table}`);
                    } else {
                        console.log(`   - search_vector already exists in ${table}`);
                    }
                } else {
                    console.log(`   - Table ${table} does not exist, skipping`);
                }
            } catch (err) {
                console.log(`   ✗ Error with ${table}: ${err.message}`);
            }
        }

        // 3. POPULATE SEARCH SYNONYMS
        console.log('\n3. Populating search synonyms...');
        const synonyms = [
            // Project terms
            ['project', 'job', 0.9],
            ['project', 'work', 0.8],
            ['project', 'task', 0.7],
            ['fiber', 'fibre', 1.0],
            ['cable', 'wire', 0.9],
            ['install', 'installation', 1.0],
            ['deploy', 'deployment', 1.0],
            ['pole', 'post', 0.9],
            ['drop', 'connection', 0.8],
            ['splice', 'joint', 0.9],
            ['test', 'testing', 1.0],
            ['commission', 'commissioning', 1.0],
            // Status terms
            ['active', 'ongoing', 1.0],
            ['active', 'in progress', 0.9],
            ['complete', 'completed', 1.0],
            ['complete', 'finished', 0.9],
            ['complete', 'done', 0.8],
            ['pending', 'waiting', 0.9],
            ['pending', 'on hold', 0.8],
            // Staff terms
            ['engineer', 'technician', 0.8],
            ['manager', 'supervisor', 0.9],
            ['lead', 'senior', 0.9],
            ['contractor', 'subcontractor', 0.9],
            ['team', 'crew', 0.9],
            // Location terms
            ['site', 'location', 1.0],
            ['area', 'region', 0.9],
            ['zone', 'sector', 0.9],
            // Equipment terms
            ['tool', 'equipment', 0.9],
            ['vehicle', 'truck', 0.8],
            ['splicer', 'fusion splicer', 1.0],
            ['otdr', 'optical time domain reflectometer', 1.0],
            ['meter', 'power meter', 0.9]
        ];

        for (const [term, synonym, weight] of synonyms) {
            await client.query(`
                INSERT INTO search_synonyms (term, synonym, weight) 
                VALUES ($1, $2, $3)
                ON CONFLICT (term, synonym) DO UPDATE SET weight = EXCLUDED.weight
            `, [term, synonym, weight]);
        }
        console.log(`   ✓ Inserted ${synonyms.length} synonyms`);

        // 4. GENERATE SEARCH HISTORY
        console.log('\n4. Generating search history data...');
        const searchQueries = [
            'fiber installation downtown', 'pole inspection route 5', 'drop connections phase 2',
            'splice enclosure inventory', 'technician availability this week', 'project status update',
            'cable pulling team alpha', 'testing equipment checkout', 'safety compliance report',
            'contractor performance metrics', 'budget variance analysis', 'milestone completion rate',
            'John Smith', 'active projects', 'pending approvals', 'equipment maintenance schedule',
            'quality assurance checklist', 'permit status municipal', 'route planning optimization',
            'workforce allocation dashboard', 'material requisition forms', 'invoice processing queue',
            'training certification expiry', 'emergency response protocol', 'weather delay impact',
            'customer installation requests', 'network expansion phase 3', 'backbone infrastructure',
            'last mile connectivity', 'rural deployment initiative', 'urban density analysis',
            'fiber optic cable specs', 'trenching requirements depth', 'aerial installation guidelines',
            'underground conduit mapping', 'right of way permits', 'environmental impact assessment',
            'project timeline gantt', 'resource utilization report', 'cost benefit analysis',
            'risk mitigation strategies', 'stakeholder communication plan', 'change order management',
            'quality control metrics', 'performance indicators KPI', 'service level agreement',
            'maintenance window schedule', 'outage notification system', 'restoration priority list',
            'inventory management system', 'spare parts availability', 'vendor contact directory',
            'procurement approval workflow', 'purchase order tracking', 'delivery status update'
        ];

        const searchTypes = ['global', 'projects', 'staff', 'contractors', 'equipment'];
        let searchCount = 0;

        for (let i = 0; i < 600; i++) {
            const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
            const searchType = searchTypes[Math.floor(Math.random() * searchTypes.length)];
            const userId = Math.random() > 0.3 ? `user_${Math.floor(Math.random() * 50)}` : null;
            const resultCount = Math.floor(Math.random() * 100);
            const duration = Math.floor(Math.random() * 500 + 50);
            const daysAgo = Math.floor(Math.random() * 90);
            
            await client.query(`
                INSERT INTO search_history (
                    user_id, search_query, search_type, result_count, 
                    search_duration_ms, created_at, filters_applied
                ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP - INTERVAL '${daysAgo} days', $6)
            `, [userId, query, searchType, resultCount, duration, JSON.stringify({
                date_range: Math.random() > 0.5 ? 'last_30_days' : 'all_time',
                status: Math.random() > 0.5 ? 'active' : null
            })]);
            searchCount++;
        }
        console.log(`   ✓ Generated ${searchCount} search history entries`);

        // 5. POPULATE POPULAR SEARCHES
        console.log('\n5. Populating popular searches...');
        await client.query(`
            INSERT INTO popular_searches (search_term, search_count, category, last_searched)
            SELECT 
                search_query,
                COUNT(*)::INTEGER,
                search_type,
                MAX(created_at)
            FROM search_history
            GROUP BY search_query, search_type
            HAVING COUNT(*) > 1
            ON CONFLICT (search_term, category) 
            DO UPDATE SET 
                search_count = popular_searches.search_count + EXCLUDED.search_count,
                last_searched = GREATEST(popular_searches.last_searched, EXCLUDED.last_searched)
        `);
        const popResult = await client.query('SELECT COUNT(*) FROM popular_searches');
        console.log(`   ✓ Created ${popResult.rows[0].count} popular searches`);

        // 6. POPULATE FILTER PRESETS
        console.log('\n6. Creating filter presets...');
        const filterPresets = [
            ['Active Projects', 'projects', {status: ['active', 'in_progress'], date_range: 'current'}, 'Show all active and in-progress projects', 'play-circle', 1],
            ['My Projects', 'projects', {assigned_to: '@current_user', status: ['active']}, 'Projects assigned to current user', 'user', 2],
            ['Urgent Projects', 'projects', {priority: 'high', status: ['active'], deadline: 'next_7_days'}, 'High priority projects due soon', 'alert-triangle', 3],
            ['Completed This Month', 'projects', {status: ['completed'], completed_date: 'current_month'}, 'Projects completed in current month', 'check-circle', 4],
            ['Overdue Projects', 'projects', {status: ['active'], end_date: 'overdue'}, 'Projects past their deadline', 'clock', 5],
            ['Available Technicians', 'staff', {role: ['technician', 'field_tech'], availability: 'available'}, 'Technicians available for assignment', 'users', 1],
            ['Certified Splicers', 'staff', {certifications: ['fiber_splicing'], status: 'active'}, 'Staff certified in fiber splicing', 'award', 2],
            ['Project Managers', 'staff', {role: ['project_manager', 'pm'], status: 'active'}, 'Active project managers', 'briefcase', 3],
            ['Available Equipment', 'equipment', {status: 'available', condition: ['good', 'excellent']}, 'Equipment ready for use', 'tool', 1],
            ['Testing Equipment', 'equipment', {category: 'testing', status: ['available', 'in_use']}, 'All testing equipment', 'activity', 3]
        ];

        for (const [name, type, config, desc, icon, order] of filterPresets) {
            await client.query(`
                INSERT INTO filter_presets (preset_name, preset_type, filter_config, description, icon, sort_order)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (preset_name, preset_type) DO UPDATE SET filter_config = EXCLUDED.filter_config
            `, [name, type, JSON.stringify(config), desc, icon, order]);
        }
        console.log(`   ✓ Created ${filterPresets.length} filter presets`);

        // 7. POPULATE AUTOCOMPLETE SUGGESTIONS
        console.log('\n7. Generating autocomplete suggestions...');
        
        // Staff skills
        const skills = [
            'Fiber Splicing', 'OTDR Testing', 'Cable Pulling', 'Fusion Splicing',
            'Network Design', 'Project Management', 'CAD Drafting', 'Permit Acquisition',
            'Quality Assurance', 'Safety Compliance', 'Underground Construction',
            'Aerial Construction', 'Directional Drilling', 'Trenching', 'Restoration',
            'Power Meter Testing', 'Visual Fault Location', 'Connector Installation',
            'Cable Termination', 'Network Troubleshooting', 'OSHA 30', 'CDL License',
            'First Aid Certified', 'Confined Space Entry', 'Aerial Lift Certified'
        ];

        for (const skill of skills) {
            await client.query(`
                INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, usage_count, confidence_score)
                VALUES ('staff_skill', $1, $2, $3)
                ON CONFLICT (suggestion_type, suggestion_text) 
                DO UPDATE SET usage_count = autocomplete_suggestions.usage_count + 1
            `, [skill, Math.floor(Math.random() * 100), 0.85 + Math.random() * 0.15]);
        }

        // Location suggestions
        const locations = [
            ['New York', 'NY'], ['Los Angeles', 'CA'], ['Chicago', 'IL'],
            ['Houston', 'TX'], ['Phoenix', 'AZ'], ['Philadelphia', 'PA'],
            ['San Antonio', 'TX'], ['San Diego', 'CA'], ['Dallas', 'TX'],
            ['San Jose', 'CA'], ['Austin', 'TX'], ['Jacksonville', 'FL'],
            ['Fort Worth', 'TX'], ['Columbus', 'OH'], ['Charlotte', 'NC'],
            ['San Francisco', 'CA'], ['Indianapolis', 'IN'], ['Seattle', 'WA'],
            ['Denver', 'CO'], ['Boston', 'MA']
        ];

        for (const [city, state] of locations) {
            await client.query(`
                INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, parent_text, usage_count, confidence_score)
                VALUES ('location', $1, $2, $3, $4)
                ON CONFLICT (suggestion_type, suggestion_text) 
                DO UPDATE SET usage_count = autocomplete_suggestions.usage_count + 1
            `, [city, state, Math.floor(Math.random() * 150), 0.9 + Math.random() * 0.1]);
        }

        // Equipment models
        const equipment = [
            ['EXFO FTB-730C', 'OTDR'], ['VIAVI MTS-2000', 'OTDR'],
            ['Yokogawa AQ7280', 'OTDR'], ['AFL FlexScan FS200', 'OTDR'],
            ['Fujikura 90S', 'Fusion Splicer'], ['Sumitomo T-72C', 'Fusion Splicer'],
            ['INNO View 7', 'Fusion Splicer'], ['Furukawa S179', 'Fusion Splicer'],
            ['EXFO PPM-350C', 'Power Meter'], ['VIAVI OLP-85', 'Power Meter'],
            ['Ford F-550', 'Bucket Truck'], ['International 4300', 'Cable Truck'],
            ['Freightliner M2', 'Splice Van'], ['Ford Transit 350', 'Service Van']
        ];

        for (const [model, category] of equipment) {
            await client.query(`
                INSERT INTO autocomplete_suggestions (suggestion_type, suggestion_text, parent_text, usage_count, confidence_score)
                VALUES ('equipment', $1, $2, $3, $4)
                ON CONFLICT (suggestion_type, suggestion_text) 
                DO UPDATE SET usage_count = autocomplete_suggestions.usage_count + 1
            `, [model, category, Math.floor(Math.random() * 60), 0.85 + Math.random() * 0.15]);
        }

        const suggestResult = await client.query('SELECT COUNT(*) FROM autocomplete_suggestions');
        console.log(`   ✓ Created ${suggestResult.rows[0].count} autocomplete suggestions`);

        // 8. CREATE SEARCH INDEXES ON EXISTING TABLES
        console.log('\n8. Creating search indexes on existing tables...');
        
        // Check which tables exist and create indexes
        const indexQueries = [
            `CREATE INDEX IF NOT EXISTS idx_projects_search ON projects USING GIN(search_vector)`,
            `CREATE INDEX IF NOT EXISTS idx_projects_name_gin ON projects USING GIN(to_tsvector('english', name))`,
            `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`,
            `CREATE INDEX IF NOT EXISTS idx_staff_search ON staff USING GIN(search_vector)`,
            `CREATE INDEX IF NOT EXISTS idx_staff_name_gin ON staff USING GIN(to_tsvector('english', COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')))`,
            `CREATE INDEX IF NOT EXISTS idx_staff_department ON staff(department)`,
            `CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role)`,
            `CREATE INDEX IF NOT EXISTS idx_clients_search ON clients USING GIN(search_vector)`,
            `CREATE INDEX IF NOT EXISTS idx_clients_name_gin ON clients USING GIN(to_tsvector('english', name))`
        ];

        for (const indexQuery of indexQueries) {
            try {
                await client.query(indexQuery);
                const indexName = indexQuery.match(/idx_\w+/)[0];
                console.log(`   ✓ Created index ${indexName}`);
            } catch (err) {
                // Index might already exist or table doesn't exist
                console.log(`   - Skipped: ${err.message.split('\n')[0]}`);
            }
        }

        // 9. UPDATE SEARCH VECTORS FOR EXISTING RECORDS
        console.log('\n9. Updating search vectors for existing records...');
        
        try {
            // Update projects search vectors
            const projectUpdate = await client.query(`
                UPDATE projects SET search_vector = 
                    setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
                    setweight(to_tsvector('english', COALESCE(client_name, '')), 'B') ||
                    setweight(to_tsvector('english', COALESCE(location, '')), 'B') ||
                    setweight(to_tsvector('english', COALESCE(status, '')), 'C')
                WHERE search_vector IS NULL
            `);
            console.log(`   ✓ Updated ${projectUpdate.rowCount} project search vectors`);
        } catch (err) {
            console.log(`   - Projects update skipped: ${err.message.split('\n')[0]}`);
        }

        try {
            // Update staff search vectors
            const staffUpdate = await client.query(`
                UPDATE staff SET search_vector = 
                    setweight(to_tsvector('english', COALESCE(first_name || ' ' || last_name, '')), 'A') ||
                    setweight(to_tsvector('english', COALESCE(email, '')), 'B') ||
                    setweight(to_tsvector('english', COALESCE(role, '')), 'B') ||
                    setweight(to_tsvector('english', COALESCE(department, '')), 'C')
                WHERE search_vector IS NULL
            `);
            console.log(`   ✓ Updated ${staffUpdate.rowCount} staff search vectors`);
        } catch (err) {
            console.log(`   - Staff update skipped: ${err.message.split('\n')[0]}`);
        }

        try {
            // Update clients search vectors
            const clientUpdate = await client.query(`
                UPDATE clients SET search_vector = 
                    setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
                    setweight(to_tsvector('english', COALESCE(company_name, '')), 'A') ||
                    setweight(to_tsvector('english', COALESCE(email, '')), 'B')
                WHERE search_vector IS NULL
            `);
            console.log(`   ✓ Updated ${clientUpdate.rowCount} client search vectors`);
        } catch (err) {
            console.log(`   - Clients update skipped: ${err.message.split('\n')[0]}`);
        }

        // 10. CREATE SEARCH FUNCTIONS
        console.log('\n10. Creating search functions...');
        
        await client.query(`
            CREATE OR REPLACE FUNCTION search_projects(query_text TEXT)
            RETURNS TABLE(
                project_id INTEGER,
                project_name TEXT,
                relevance FLOAT,
                snippet TEXT
            ) AS $$
            BEGIN
                RETURN QUERY
                SELECT 
                    p.id,
                    p.name::TEXT,
                    ts_rank_cd(p.search_vector, plainto_tsquery('english', query_text)) AS relevance,
                    ts_headline('english', 
                        COALESCE(p.name, ''),
                        plainto_tsquery('english', query_text),
                        'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=10'
                    ) AS snippet
                FROM projects p
                WHERE p.search_vector @@ plainto_tsquery('english', query_text)
                ORDER BY relevance DESC
                LIMIT 50;
            END;
            $$ LANGUAGE plpgsql
        `);
        console.log('   ✓ Created search_projects function');

        await client.query(`
            CREATE OR REPLACE FUNCTION global_search(query_text TEXT, max_results INTEGER DEFAULT 20)
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
                        ts_headline('english', COALESCE(p.name, ''),
                            plainto_tsquery('english', query_text))::TEXT
                    FROM projects p
                    WHERE p.search_vector @@ plainto_tsquery('english', query_text)
                    
                    UNION ALL
                    
                    -- Search staff
                    SELECT 
                        'staff'::TEXT,
                        s.id,
                        (s.first_name || ' ' || s.last_name)::TEXT,
                        ts_rank_cd(s.search_vector, plainto_tsquery('english', query_text)),
                        ts_headline('english', COALESCE(s.first_name || ' ' || s.last_name, '') || ' - ' || COALESCE(s.role, ''),
                            plainto_tsquery('english', query_text))::TEXT
                    FROM staff s
                    WHERE s.search_vector @@ plainto_tsquery('english', query_text)
                    
                    UNION ALL
                    
                    -- Search clients  
                    SELECT 
                        'client'::TEXT,
                        c.id,
                        c.name::TEXT,
                        ts_rank_cd(c.search_vector, plainto_tsquery('english', query_text)),
                        ts_headline('english', COALESCE(c.name, ''),
                            plainto_tsquery('english', query_text))::TEXT
                    FROM clients c
                    WHERE c.search_vector @@ plainto_tsquery('english', query_text)
                ) as results
                ORDER BY relevance DESC
                LIMIT max_results;
            END;
            $$ LANGUAGE plpgsql
        `);
        console.log('   ✓ Created global_search function');

        // 11. CREATE MATERIALIZED VIEW FOR SEARCH SUGGESTIONS
        console.log('\n11. Creating materialized view for search suggestions...');
        
        await client.query(`
            CREATE MATERIALIZED VIEW IF NOT EXISTS search_suggestions AS
            SELECT 
                'recent' as suggestion_category,
                search_query as suggestion,
                COUNT(*)::INTEGER as popularity,
                MAX(created_at) as last_used
            FROM search_history
            WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
            GROUP BY search_query
            HAVING COUNT(*) > 2

            UNION ALL

            SELECT 
                'popular' as suggestion_category,
                search_term as suggestion,
                search_count as popularity,
                last_searched as last_used
            FROM popular_searches
            WHERE search_count > 5

            UNION ALL

            SELECT 
                'trending' as suggestion_category,
                search_query as suggestion,
                COUNT(*)::INTEGER as popularity,
                MAX(created_at) as last_used
            FROM search_history
            WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
            GROUP BY search_query
            HAVING COUNT(*) > 3

            ORDER BY popularity DESC, last_used DESC
        `);
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_search_suggestions ON search_suggestions(suggestion_category, popularity DESC)`);
        await client.query(`REFRESH MATERIALIZED VIEW search_suggestions`);
        console.log('   ✓ Created and refreshed search_suggestions materialized view');

        // Commit transaction
        await client.query('COMMIT');
        console.log('\n✅ Transaction committed successfully!');

        // VERIFICATION
        console.log('\n=== VERIFICATION ===');
        
        const verifyQueries = [
            { name: 'Search Synonyms', query: 'SELECT COUNT(*) as count FROM search_synonyms' },
            { name: 'Search History', query: 'SELECT COUNT(*) as count FROM search_history' },
            { name: 'Popular Searches', query: 'SELECT COUNT(*) as count FROM popular_searches' },
            { name: 'Filter Presets', query: 'SELECT COUNT(*) as count FROM filter_presets' },
            { name: 'Autocomplete Suggestions', query: 'SELECT COUNT(*) as count FROM autocomplete_suggestions' },
            { name: 'Saved Filters', query: 'SELECT COUNT(*) as count FROM saved_filters' },
            { name: 'Search Metrics', query: 'SELECT COUNT(*) as count FROM search_metrics' }
        ];

        for (const verify of verifyQueries) {
            const result = await client.query(verify.query);
            console.log(`${verify.name}: ${result.rows[0].count} records`);
        }

        // Test search functions
        console.log('\n=== TESTING SEARCH FUNCTIONS ===');
        
        const searchTest = await client.query("SELECT * FROM global_search('fiber', 5)");
        console.log(`Global search for 'fiber': Found ${searchTest.rows.length} results`);
        
        if (searchTest.rows.length > 0) {
            console.log('\nSample search results:');
            searchTest.rows.forEach(row => {
                console.log(`  - ${row.result_type}: ${row.result_title} (relevance: ${row.relevance.toFixed(4)})`);
            });
        }

        // Test search suggestions
        const suggestions = await client.query("SELECT * FROM search_suggestions LIMIT 5");
        console.log(`\nTop search suggestions: ${suggestions.rows.length} results`);
        suggestions.rows.forEach(row => {
            console.log(`  - [${row.suggestion_category}] "${row.suggestion}" (popularity: ${row.popularity})`);
        });

        console.log('\n✨ Search indexes and metadata successfully populated!');
        console.log('\nThe following features are now available:');
        console.log('  • Full-text search on projects, staff, and clients');
        console.log('  • Search synonyms for query expansion');
        console.log('  • Search history tracking and analytics');
        console.log('  • Popular and trending searches');
        console.log('  • Filter presets and saved filters');
        console.log('  • Autocomplete suggestions for various fields');
        console.log('  • Search performance metrics');
        console.log('  • Global search function across multiple tables');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n❌ Error occurred, transaction rolled back:', err.message);
        throw err;
    } finally {
        await client.end();
        console.log('\n🔒 Database connection closed.');
    }
}

// Run the script
populateSearchIndexes().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});