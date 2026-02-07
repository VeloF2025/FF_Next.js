const { neon } = require('@neondatabase/serverless');

// Database connection
const DATABASE_URL = process.env.DATABASE_URL;
const sql = neon(DATABASE_URL);

module.exports = async (req, res) => {
  try {
    // Get overview statistics
    const stats = await sql`
      SELECT 
        (SELECT COUNT(*) FROM contractors WHERE status = 'Active') as active_contractors,
        (SELECT COUNT(*) FROM contractor_teams) as total_teams,
        (SELECT COUNT(*) FROM team_members WHERE status = 'Active') as active_members,
        (SELECT COUNT(*) FROM project_assignments WHERE status IN ('Active', 'In Progress')) as active_assignments,
        (SELECT COUNT(DISTINCT contractor_id) FROM contractor_rag_scores) as contractors_with_scores,
        (SELECT AVG(safety_rating) FROM contractors) as avg_safety_rating,
        (SELECT AVG(quality_score) FROM contractors) as avg_quality_score,
        (SELECT AVG(on_time_delivery) FROM contractors) as avg_delivery_score
    `;

    // Get top performing contractors
    const topContractors = await sql`
      SELECT 
        c.company_name,
        c.registration_number,
        c.city,
        c.province,
        c.bee_level,
        c.safety_rating,
        c.quality_score,
        c.on_time_delivery,
        c.rag_overall,
        c.status,
        COUNT(DISTINCT ct.id) as team_count,
        COUNT(DISTINCT tm.id) as member_count
      FROM contractors c
      LEFT JOIN contractor_teams ct ON c.id = ct.contractor_id
      LEFT JOIN team_members tm ON c.id = tm.contractor_id
      WHERE c.status = 'Active'
      GROUP BY c.id, c.company_name, c.registration_number, c.city, c.province, 
               c.bee_level, c.safety_rating, c.quality_score, c.on_time_delivery, 
               c.rag_overall, c.status
      ORDER BY c.quality_score DESC NULLS LAST
      LIMIT 10
    `;

    // Get recent RAG assessments
    const recentScores = await sql`
      SELECT 
        c.company_name,
        r.assessment_date,
        r.performance_score,
        r.quality_score,
        r.safety_score,
        r.compliance_score,
        r.financial_score,
        r.overall_score,
        r.rag_status
      FROM contractor_rag_scores r
      JOIN contractors c ON r.contractor_id = c.id
      ORDER BY r.assessment_date DESC
      LIMIT 20
    `;

    // Get teams by specialization
    const teamsBySpecialization = await sql`
      SELECT 
        specialization,
        COUNT(*) as team_count,
        AVG(performance_score) as avg_performance
      FROM contractor_teams
      WHERE specialization IS NOT NULL
      GROUP BY specialization
      ORDER BY team_count DESC
    `;

    // Get BEE level distribution
    const beeDistribution = await sql`
      SELECT 
        bee_level,
        COUNT(*) as count,
        AVG(safety_rating) as avg_safety,
        AVG(quality_score) as avg_quality
      FROM contractors
      WHERE bee_level IS NOT NULL
      GROUP BY bee_level
      ORDER BY bee_level
    `;

    // Get active project assignments with contractor details
    const activeAssignments = await sql`
      SELECT 
        pa.project_id,
        c.company_name,
        ct.team_name,
        pa.assignment_type,
        pa.scope,
        pa.start_date,
        pa.end_date,
        pa.progress_percentage,
        pa.status
      FROM project_assignments pa
      JOIN contractors c ON pa.contractor_id = c.id
      LEFT JOIN contractor_teams ct ON pa.team_id = ct.id
      WHERE pa.status IN ('Active', 'In Progress')
      ORDER BY pa.start_date DESC
      LIMIT 15
    `;

    // Get team member statistics by role
    const membersByRole = await sql`
      SELECT 
        role,
        COUNT(*) as count,
        AVG(years_experience) as avg_experience,
        AVG(performance_rating) as avg_performance,
        AVG(safety_score) as avg_safety
      FROM team_members
      WHERE role IS NOT NULL
      GROUP BY role
      ORDER BY count DESC
    `;

    // Format response
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        overview: {
          active_contractors: parseInt(stats[0].active_contractors),
          total_teams: parseInt(stats[0].total_teams),
          active_members: parseInt(stats[0].active_members),
          active_assignments: parseInt(stats[0].active_assignments),
          contractors_with_scores: parseInt(stats[0].contractors_with_scores),
          averages: {
            safety_rating: parseFloat(stats[0].avg_safety_rating).toFixed(2),
            quality_score: parseFloat(stats[0].avg_quality_score).toFixed(2),
            delivery_score: parseFloat(stats[0].avg_delivery_score).toFixed(2)
          }
        },
        bee_distribution: beeDistribution.map(b => ({
          level: b.bee_level,
          count: parseInt(b.count),
          avg_safety: parseFloat(b.avg_safety).toFixed(2),
          avg_quality: parseFloat(b.avg_quality).toFixed(2)
        })),
        team_specializations: teamsBySpecialization.map(t => ({
          specialization: t.specialization,
          team_count: parseInt(t.team_count),
          avg_performance: t.avg_performance ? parseFloat(t.avg_performance).toFixed(2) : null
        })),
        member_roles: membersByRole.map(m => ({
          role: m.role,
          count: parseInt(m.count),
          avg_experience: m.avg_experience ? parseFloat(m.avg_experience).toFixed(1) : null,
          avg_performance: m.avg_performance ? parseFloat(m.avg_performance).toFixed(2) : null,
          avg_safety: m.avg_safety ? parseFloat(m.avg_safety).toFixed(2) : null
        }))
      },
      top_contractors: topContractors.map(c => ({
        company: c.company_name,
        registration: c.registration_number,
        location: `${c.city}, ${c.province}`,
        bee_level: c.bee_level,
        scores: {
          safety: parseFloat(c.safety_rating).toFixed(1),
          quality: parseFloat(c.quality_score).toFixed(1),
          delivery: parseFloat(c.on_time_delivery).toFixed(1)
        },
        rag_status: c.rag_overall,
        status: c.status,
        resources: {
          teams: parseInt(c.team_count),
          members: parseInt(c.member_count)
        }
      })),
      recent_assessments: recentScores.map(s => ({
        contractor: s.company_name,
        date: s.assessment_date,
        scores: {
          performance: s.performance_score,
          quality: s.quality_score,
          safety: s.safety_score,
          compliance: s.compliance_score,
          financial: s.financial_score,
          overall: s.overall_score
        },
        rag_status: s.rag_status
      })),
      active_assignments: activeAssignments.map(a => ({
        project_id: a.project_id,
        contractor: a.company_name,
        team: a.team_name,
        type: a.assignment_type,
        scope: a.scope,
        dates: {
          start: a.start_date,
          end: a.end_date
        },
        progress: a.progress_percentage,
        status: a.status
      })),
      data_quality: {
        contractors_populated: topContractors.length > 0,
        teams_populated: parseInt(stats[0].total_teams) > 0,
        members_populated: parseInt(stats[0].active_members) > 0,
        scores_populated: recentScores.length > 0,
        assignments_populated: activeAssignments.length > 0
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching contractor demo data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contractor demo data',
      message: error.message
    });
  }
};