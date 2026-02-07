#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');

// Database connection
const DATABASE_URL = 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

async function verifyData() {
  console.log('🔍 CONTRACTOR DATA VERIFICATION REPORT\n');
  console.log('=' .repeat(60));
  
  try {
    // 1. Overview Statistics
    const stats = await sql`
      SELECT 
        (SELECT COUNT(*) FROM contractors) as total_contractors,
        (SELECT COUNT(*) FROM contractors WHERE status = 'Active') as active_contractors,
        (SELECT COUNT(*) FROM contractor_teams) as total_teams,
        (SELECT COUNT(*) FROM team_members) as total_members,
        (SELECT COUNT(*) FROM project_assignments) as total_assignments,
        (SELECT COUNT(*) FROM contractor_rag_scores) as total_rag_scores
    `;
    
    console.log('\n📊 DATABASE STATISTICS:');
    console.log(`  ✓ Contractors: ${stats[0].total_contractors} (${stats[0].active_contractors} active)`);
    console.log(`  ✓ Teams: ${stats[0].total_teams}`);
    console.log(`  ✓ Team Members: ${stats[0].total_members}`);
    console.log(`  ✓ Project Assignments: ${stats[0].total_assignments}`);
    console.log(`  ✓ RAG Scores: ${stats[0].total_rag_scores}`);
    
    // 2. Sample Contractors with SA Details
    console.log('\n🏢 SAMPLE SOUTH AFRICAN CONTRACTORS:');
    const contractors = await sql`
      SELECT 
        company_name,
        registration_number as "CIPC Number",
        city,
        province,
        bee_level as "B-BBEE Level",
        safety_rating,
        rag_overall as "RAG Status"
      FROM contractors
      ORDER BY company_name
      LIMIT 10
    `;
    console.table(contractors);
    
    // 3. BEE Level Distribution
    console.log('\n📈 B-BBEE LEVEL DISTRIBUTION:');
    const beeStats = await sql`
      SELECT 
        bee_level,
        COUNT(*) as count,
        ROUND(AVG(safety_rating), 1) as avg_safety_rating
      FROM contractors
      WHERE bee_level IS NOT NULL
      GROUP BY bee_level
      ORDER BY bee_level
    `;
    console.table(beeStats);
    
    // 4. Teams by Location
    console.log('\n📍 TEAMS BY LOCATION:');
    const teamLocations = await sql`
      SELECT 
        COALESCE(base_location, 'Not specified') as location,
        COUNT(*) as team_count,
        SUM(max_capacity) as total_capacity
      FROM contractor_teams
      GROUP BY base_location
      ORDER BY team_count DESC
      LIMIT 5
    `;
    console.table(teamLocations);
    
    // 5. Top Performing Contractors
    console.log('\n🏆 TOP PERFORMING CONTRACTORS:');
    const topPerformers = await sql`
      SELECT 
        c.company_name,
        c.quality_score,
        c.safety_rating,
        c.on_time_delivery,
        COUNT(DISTINCT ct.id) as teams,
        COUNT(DISTINCT tm.id) as staff
      FROM contractors c
      LEFT JOIN contractor_teams ct ON c.id = ct.contractor_id
      LEFT JOIN team_members tm ON c.id = tm.contractor_id
      GROUP BY c.id, c.company_name, c.quality_score, c.safety_rating, c.on_time_delivery
      ORDER BY c.quality_score DESC NULLS LAST
      LIMIT 5
    `;
    console.table(topPerformers);
    
    // 6. Team Member Roles
    console.log('\n👥 TEAM MEMBER DISTRIBUTION BY ROLE:');
    const roles = await sql`
      SELECT 
        COALESCE(role, 'Unspecified') as role,
        COUNT(*) as count,
        ROUND(AVG(years_experience), 1) as avg_experience_years
      FROM team_members
      GROUP BY role
      ORDER BY count DESC
    `;
    console.table(roles);
    
    // 7. RAG Score Summary (if data exists)
    if (stats[0].total_rag_scores > 0) {
      console.log('\n📊 RAG SCORE SUMMARY:');
      const ragSummary = await sql`
        SELECT 
          rag_status,
          COUNT(*) as count,
          ROUND(AVG(overall_score), 1) as avg_score
        FROM contractor_rag_scores
        WHERE rag_status IS NOT NULL
        GROUP BY rag_status
        ORDER BY avg_score DESC
      `;
      console.table(ragSummary);
    }
    
    // 8. Data Completeness Check
    console.log('\n✅ DATA COMPLETENESS CHECK:');
    const completeness = await sql`
      SELECT 
        'Contractors with BEE Level' as metric,
        COUNT(*) FILTER (WHERE bee_level IS NOT NULL) as populated,
        COUNT(*) as total,
        ROUND(100.0 * COUNT(*) FILTER (WHERE bee_level IS NOT NULL) / COUNT(*), 1) as percentage
      FROM contractors
      UNION ALL
      SELECT 
        'Contractors with Safety Rating',
        COUNT(*) FILTER (WHERE safety_rating IS NOT NULL),
        COUNT(*),
        ROUND(100.0 * COUNT(*) FILTER (WHERE safety_rating IS NOT NULL) / COUNT(*), 1)
      FROM contractors
      UNION ALL
      SELECT 
        'Teams with Specialization',
        COUNT(*) FILTER (WHERE specialization IS NOT NULL),
        COUNT(*),
        ROUND(100.0 * COUNT(*) FILTER (WHERE specialization IS NOT NULL) / COUNT(*), 1)
      FROM contractor_teams
      UNION ALL
      SELECT 
        'Members with Contact Info',
        COUNT(*) FILTER (WHERE email IS NOT NULL AND phone IS NOT NULL),
        COUNT(*),
        ROUND(100.0 * COUNT(*) FILTER (WHERE email IS NOT NULL AND phone IS NOT NULL) / COUNT(*), 1)
      FROM team_members
    `;
    console.table(completeness);
    
    console.log('\n' + '=' .repeat(60));
    console.log('✅ CONTRACTOR DATA VERIFICATION COMPLETE!\n');
    
    // Summary
    const summary = {
      status: 'SUCCESS',
      contractors_loaded: stats[0].total_contractors > 0,
      teams_loaded: stats[0].total_teams > 0,
      members_loaded: stats[0].total_members > 0,
      sa_specific_data: contractors.some(c => c["CIPC Number"] && c["B-BBEE Level"]),
      recommendation: stats[0].total_contractors >= 25 ? 
        '✅ Sufficient demo data for testing' : 
        '⚠️ Consider adding more contractors for comprehensive testing'
    };
    
    console.log('📋 SUMMARY:');
    console.log(JSON.stringify(summary, null, 2));
    
  } catch (error) {
    console.error('❌ Error verifying data:', error.message);
    process.exit(1);
  }
}

// Run verification
verifyData().catch(console.error);