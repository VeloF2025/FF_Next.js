import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { safeArrayQuery, safeMutation } from '../../../../lib/safe-query';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    try {
      // Return empty data for now - schedules functionality pending migration
      const schedules = await safeArrayQuery(
        async () => [],
        { logError: false }
      );
      
      res.status(200).json({
        schedules,
        total: 0,
        taskCounts: [],
        message: 'Schedules functionality is being migrated'
      });
    } catch (error) {
      console.error('Error fetching schedules:', error);
      res.status(500).json({ error: 'Failed to fetch schedules' });
    }
  } else if (req.method === 'POST') {
    // Temporarily disabled during migration
    res.status(503).json({ 
      error: 'Schedule creation is temporarily disabled during migration',
      message: 'This feature will be available soon'
    });
  } else if (req.method === 'PUT') {
    // Temporarily disabled during migration
    res.status(503).json({ 
      error: 'Schedule updates are temporarily disabled during migration',
      message: 'This feature will be available soon'
    });
  } else if (req.method === 'DELETE') {
    // Temporarily disabled during migration
    res.status(503).json({ 
      error: 'Schedule deletion is temporarily disabled during migration',
      message: 'This feature will be available soon'
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);