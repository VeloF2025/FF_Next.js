import { sql } from '@/lib/neon';
import { NextApiRequest, NextApiResponse } from 'next';

interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: {
    gitCommit: string;
    gitCommitShort: string;
    builtAt: string;
    environment: string;
  };
  checks: {
    database: 'connected' | 'error' | 'pending';
    memory: 'ok' | 'high' | 'critical' | 'pending';
    environment: 'ok' | 'error';
  };
  details: {
    memory?: {
      heapUsed: string;
      heapTotal: string;
      rss: string;
      external: string;
    };
    database?: {
      latency?: number;
      error?: string;
    };
    environment?: {
      nodeVersion: string;
      nextVersion?: string;
      environment: string;
    };
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthCheck>
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: 0,
      version: {
        gitCommit: process.env.GIT_SHA || 'unknown',
        gitCommitShort: process.env.GIT_SHA_SHORT || 'unknown',
        builtAt: process.env.BUILD_TIMESTAMP || 'unknown',
        environment: process.env.NODE_ENV || 'unknown',
      },
      checks: {
        database: 'error',
        memory: 'ok',
        environment: 'error',
      },
      details: {},
    } as HealthCheck);
  }

  const health: HealthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: {
      gitCommit: process.env.GIT_SHA || 'unknown',
      gitCommitShort: process.env.GIT_SHA_SHORT || 'unknown',
      builtAt: process.env.BUILD_TIMESTAMP || 'unknown',
      environment: process.env.NODE_ENV || 'unknown',
    },
    checks: {
      database: 'pending',
      memory: 'pending',
      environment: 'pending',
    },
    details: {},
  };

  try {
    // Database check with latency measurement
    const dbStart = Date.now();
    try {
      const result = await sql`SELECT 1 as check, current_timestamp as time`;
      const dbLatency = Date.now() - dbStart;
      
      if (result && result[0]?.check === 1) {
        health.checks.database = 'connected';
        health.details.database = { latency: dbLatency };
      } else {
        health.checks.database = 'error';
        health.details.database = { error: 'Invalid response from database' };
      }
    } catch (dbError) {
      health.checks.database = 'error';
      health.details.database = {
        error: dbError instanceof Error ? dbError.message : 'Unknown database error',
      };
    }

    // Memory check
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / (1024 * 1024);
    const heapTotalMB = usage.heapTotal / (1024 * 1024);
    
    health.details.memory = {
      heapUsed: `${heapUsedMB.toFixed(2)} MB`,
      heapTotal: `${heapTotalMB.toFixed(2)} MB`,
      rss: `${(usage.rss / (1024 * 1024)).toFixed(2)} MB`,
      external: `${(usage.external / (1024 * 1024)).toFixed(2)} MB`,
    };

    // Memory thresholds
    if (heapUsedMB < 500) {
      health.checks.memory = 'ok';
    } else if (heapUsedMB < 800) {
      health.checks.memory = 'high';
      health.status = 'degraded';
    } else {
      health.checks.memory = 'critical';
      health.status = 'unhealthy';
    }

    // Environment check
    try {
      health.checks.environment = 'ok';
      health.details.environment = {
        nodeVersion: process.version,
        nextVersion: process.env.NEXT_RUNTIME ? 'edge' : 'node',
        environment: process.env.NODE_ENV || 'development',
      };
    } catch {
      health.checks.environment = 'error';
    }

    // Determine overall health status
    const checksArray = Object.values(health.checks);
    if (checksArray.includes('error')) {
      health.status = 'unhealthy';
    } else if (checksArray.includes('critical')) {
      health.status = 'unhealthy';
    } else if (checksArray.includes('high')) {
      health.status = 'degraded';
    }

    // Set appropriate HTTP status code
    const statusCode = health.status === 'healthy' ? 200 :
                       health.status === 'degraded' ? 200 : 503;

    // Set cache headers (don't cache health checks)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Strip internal details from public response - only expose status and checks
    return res.status(statusCode).json({
      status: health.status,
      timestamp: health.timestamp,
      checks: health.checks,
    } as HealthCheck);
  } catch (error) {
    // Critical failure
    health.status = 'unhealthy';
    health.checks = {
      database: 'error',
      memory: 'error',
      environment: 'error',
    };
    
    return res.status(503).json({
      status: health.status,
      timestamp: health.timestamp,
      checks: health.checks,
    } as HealthCheck);
  }
}