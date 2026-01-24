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
    const result = await sql`
      SELECT 
        COUNT(*) as total_clients,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_clients,
        COUNT(CASE WHEN status = 'INACTIVE' THEN 1 END) as inactive_clients,
        COUNT(CASE WHEN metadata->>'priority' = 'HIGH' THEN 1 END) as high_priority,
        COUNT(CASE WHEN metadata->>'category' = 'PREMIUM' THEN 1 END) as premium_clients
      FROM clients
    `;
    
    const summary = {
      totalClients: parseInt(result[0].total_clients),
      activeClients: parseInt(result[0].active_clients),
      inactiveClients: parseInt(result[0].inactive_clients),
      prospectClients: 0,
      totalProjectValue: 0,
      averageProjectValue: 0,
      topClientsByValue: [],
      clientsByCategory: {},
      clientsByStatus: {
        ACTIVE: parseInt(result[0].active_clients),
        INACTIVE: parseInt(result[0].inactive_clients)
      },
      clientsByPriority: {
        HIGH: parseInt(result[0].high_priority)
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