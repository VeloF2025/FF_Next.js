/**
 * Polling-based real-time API
 * Alternative to LISTEN/NOTIFY for Neon compatibility
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL || '');

// Store last check timestamp per client
const lastChecked = new Map<string, Date>();

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { since, clientId = 'default' } = req.query;
  
  try {
    // Get the timestamp to check from
    const checkFrom = since 
      ? new Date(since as string)
      : lastChecked.get(clientId as string) || new Date(Date.now() - 5000);
    
    // Query for recent changes in all monitored tables
    const changes: any[] = [];
    
    // Check projects table
    const projectChanges = await sql`
      SELECT 
        'project' as entity_type,
        'modified' as event_type,
        id as entity_id,
        updated_at as timestamp,
        row_to_json(projects.*) as data
      FROM projects
      WHERE updated_at > ${checkFrom}
      ORDER BY updated_at DESC
      LIMIT 10
    `;
    changes.push(...projectChanges);
    
    // Check clients table
    const clientChanges = await sql`
      SELECT 
        'client' as entity_type,
        'modified' as event_type,
        id as entity_id,
        updated_at as timestamp,
        row_to_json(clients.*) as data
      FROM clients
      WHERE updated_at > ${checkFrom}
      ORDER BY updated_at DESC
      LIMIT 10
    `;
    changes.push(...clientChanges);
    
    // Check staff table
    const staffChanges = await sql`
      SELECT 
        'staff' as entity_type,
        'modified' as event_type,
        id as entity_id,
        updated_at as timestamp,
        row_to_json(staff.*) as data
      FROM staff
      WHERE updated_at > ${checkFrom}
      ORDER BY updated_at DESC
      LIMIT 10
    `;
    changes.push(...staffChanges);
    
    // Update last checked time
    lastChecked.set(clientId as string, new Date());
    
    // Sort all changes by timestamp
    changes.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    res.status(200).json({
      changes,
      lastChecked: new Date(),
      count: changes.length
    });
    
  } catch (error: any) {
    console.error('Polling error:', error);
    res.status(500).json({
      error: 'Failed to fetch changes',
      message: error.message
    });
  }
}

export default withAuth(handler);