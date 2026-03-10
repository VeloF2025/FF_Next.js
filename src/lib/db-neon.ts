/**
 * Neon HTTP Driver — Singleton with Connection Pooling
 *
 * Sets neonConfig.fetchConnectionCache = true globally so all neon() calls
 * reuse HTTP connections rather than opening a new connection per query.
 *
 * This resolves resource leak risk from 450+ direct neon() calls across the
 * codebase without requiring any query rewrites or API changes.
 *
 * Usage — replace:
 *   import { neon } from '@neondatabase/serverless';
 * with:
 *   import { neon } from '@/lib/db-neon';
 *
 * All existing sql`template literal` usage remains unchanged.
 *
 * @see https://neon.tech/docs/serverless/serverless-driver#use-the-cache-option
 */

import { neon, neonConfig, NeonQueryFunction } from '@neondatabase/serverless';

// Enable HTTP connection caching globally — reuses connections across queries
// rather than establishing a new HTTP connection per neon() call.
neonConfig.fetchConnectionCache = true;

export { neon, neonConfig };
export type { NeonQueryFunction };
