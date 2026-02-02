import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Get client stats
    const clientResult = await sql`
      SELECT
        COUNT(*) as total_clients,
        COUNT(CASE WHEN LOWER(status) = 'active' THEN 1 END) as active_clients,
        COUNT(CASE WHEN LOWER(status) = 'inactive' THEN 1 END) as inactive_clients
      FROM clients
    `;

    // Get project stats across all clients
    const projectResult = await sql`
      SELECT
        COUNT(*) as total_projects,
        COALESCE(SUM(budget), 0) as total_value
      FROM projects p
      WHERE p.client_id IS NOT NULL
    `;

    const summary = {
      totalClients: parseInt(clientResult[0].total_clients || '0'),
      activeClients: parseInt(clientResult[0].active_clients || '0'),
      inactiveClients: parseInt(clientResult[0].inactive_clients || '0'),
      prospectClients: 0,
      totalProjects: parseInt(projectResult[0].total_projects || '0'),
      totalProjectValue: parseFloat(projectResult[0].total_value || '0'),
      averageProjectValue: 0,
      topClientsByValue: [],
      clientsByCategory: {},
      clientsByStatus: {
        ACTIVE: parseInt(clientResult[0].active_clients || '0'),
        INACTIVE: parseInt(clientResult[0].inactive_clients || '0')
      },
      clientsByPriority: {
        HIGH: 0
      },
      monthlyGrowth: 0,
      conversionRate: 0
    };

    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    console.error('Client Summary API Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
}

export default withAuth(handler);