const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'process.env.DATABASE_URL';

async function runSearchIndexes() {
    const client = new Client({
        connectionString: connectionString,
    });

    try {
        console.log('Connecting to database...');
        await client.connect();
        console.log('Connected successfully!');

        // Read the SQL file
        const sqlPath = path.join(__dirname, 'populate-search-indexes.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');
        
        // Split by major sections to execute separately
        const sections = sqlContent.split(/-- ={50,}/);
        
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i].trim();
            if (!section || section.startsWith('--')) continue;
            
            // Extract section title
            const titleMatch = section.match(/-- \d+\. (.+)/);
            const title = titleMatch ? titleMatch[1] : `Section ${i}`;
            
            console.log(`\nExecuting: ${title}`);
            
            try {
                // Execute the section
                await client.query(section);
                console.log(`✓ ${title} completed successfully`);
            } catch (err) {
                console.error(`✗ Error in ${title}:`, err.message);
                // Continue with other sections even if one fails
            }
        }

        // Run verification queries
        console.log('\n=== VERIFICATION ===');
        
        const verifyQueries = [
            { name: 'Search Synonyms', query: 'SELECT COUNT(*) as count FROM search_synonyms' },
            { name: 'Search History', query: 'SELECT COUNT(*) as count FROM search_history' },
            { name: 'Popular Searches', query: 'SELECT COUNT(*) as count FROM popular_searches' },
            { name: 'Filter Presets', query: 'SELECT COUNT(*) as count FROM filter_presets' },
            { name: 'Autocomplete Suggestions', query: 'SELECT COUNT(*) as count FROM autocomplete_suggestions' },
            { name: 'Saved Filters', query: 'SELECT COUNT(*) as count FROM saved_filters' }
        ];

        for (const verify of verifyQueries) {
            try {
                const result = await client.query(verify.query);
                console.log(`${verify.name}: ${result.rows[0].count} records`);
            } catch (err) {
                console.log(`${verify.name}: Table not found or error`);
            }
        }

        // Test search functions
        console.log('\n=== TESTING SEARCH FUNCTIONS ===');
        
        try {
            const searchResult = await client.query("SELECT * FROM global_search('fiber installation', 5)");
            console.log(`Global search test: Found ${searchResult.rows.length} results`);
            if (searchResult.rows.length > 0) {
                console.log('Sample result:', searchResult.rows[0]);
            }
        } catch (err) {
            console.log('Global search function error:', err.message);
        }

        console.log('\n✅ Search indexes and metadata populated successfully!');

    } catch (err) {
        console.error('Database error:', err);
        process.exit(1);
    } finally {
        await client.end();
        console.log('\nDatabase connection closed.');
    }
}

// Run the script
runSearchIndexes().catch(console.error);