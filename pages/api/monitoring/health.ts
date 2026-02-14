/**
 * Health endpoint alias for monitoring tools
 * 
 * This endpoint provides the same health check functionality as /api/health
 * but is located at /api/monitoring/health for compatibility with monitoring
 * systems that expect health checks at standardized paths.
 * 
 * Re-exports the main health endpoint handler.
 */

import handler from '../health';

export default handler;
