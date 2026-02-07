import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { safeArrayQuery } from '../../../../lib/safe-query';
import { log } from '@/lib/logger';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    try {
      // Return empty data for now - quality checks functionality pending migration
      const qualityChecks = await safeArrayQuery(
        async () => [],
        { logError: false }
      );
      
      const stats = {
        totalChecks: 0,
        passed: 0,
        failed: 0,
        averageScore: 0,
        byType: {}
      };
      
      res.status(200).json({
        qualityChecks,
        total: 0,
        stats,
        message: 'Quality checks functionality is being migrated'
      });
    } catch (error) {
      log.error('Error fetching quality checks', { error });
      res.status(500).json({ error: 'Failed to fetch quality checks' });
    }
  } else if (req.method === 'POST') {
    // Temporarily disabled during migration
    res.status(503).json({ 
      error: 'Quality check creation is temporarily disabled during migration',
      message: 'This feature will be available soon'
    });
  } else if (req.method === 'PUT') {
    // Temporarily disabled during migration
    res.status(503).json({ 
      error: 'Quality check updates are temporarily disabled during migration',
      message: 'This feature will be available soon'
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);