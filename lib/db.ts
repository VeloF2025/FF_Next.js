// Database connection export for compatibility
import { Pool } from 'pg';

// Create a pool instance for database connections.
// max:10 (not 20) to match @/lib/db.ts and the Neon shim — every fibreflow_user
// pool shares the same ~61-slot budget after Supabase internal overhead, so no
// single module should be allowed to grab 20. application_name aids saturation
// triage (PORT 3000 = prod, 3005 = dev).
export const db = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  application_name: `ff-compat-${process.env.PORT || 'app'}`,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export default db;