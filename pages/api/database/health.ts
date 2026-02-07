import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Database Health Check API Route
 * Checks the database connection status directly using Neon
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Direct database health check using Neon
    const result = await sql`SELECT NOW() as time, version() as version`;
    
    return res.status(200).json({ 
      status: 'healthy',
      database: 'connected',
      timestamp: result[0].time,
      version: result[0].version,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    log.error('Health check error', { error });
    return res.status(503).json({ 
      status: 'unhealthy',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Database connection failed',
      environment: process.env.NODE_ENV || 'development'
    });
  }
}