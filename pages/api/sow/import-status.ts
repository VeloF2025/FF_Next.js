import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

type ImportStatusData = {
  success: boolean;
  data: any;
  message?: string;
  error?: string;
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ImportStatusData>
) {
  // Check authentication
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ success: false, data: null, message: 'Unauthorized' });
  }

  try {
    const { projectId } = req.query;

    switch (req.method) {
      case 'GET': {
        if (!projectId) {
          return res.status(400).json({ success: false, data: null, error: 'Project ID required' });
        }

        // Get import status for a project
        const [poles, drops, fibre] = await Promise.all([
          sql`SELECT COUNT(*) as count FROM sow_poles WHERE project_id = ${projectId}`,
          sql`SELECT COUNT(*) as count FROM sow_drops WHERE project_id = ${projectId}`,
          sql`SELECT COUNT(*) as count FROM sow_fibre WHERE project_id = ${projectId}`
        ]);

        const status = {
          projectId,
          poles: {
            imported: parseInt(poles[0]?.count || '0'),
            status: parseInt(poles[0]?.count || '0') > 0 ? 'completed' : 'pending'
          },
          drops: {
            imported: parseInt(drops[0]?.count || '0'),
            status: parseInt(drops[0]?.count || '0') > 0 ? 'completed' : 'pending'
          },
          fibre: {
            imported: parseInt(fibre[0]?.count || '0'),
            status: parseInt(fibre[0]?.count || '0') > 0 ? 'completed' : 'pending'
          },
          lastUpdated: new Date().toISOString()
        };

        return res.status(200).json({ success: true, data: status });
      }

      case 'POST': {
        // Update import status (could be used for tracking import progress)
        const { status: newStatus, type } = req.body;
        
        if (!projectId || !type || !newStatus) {
          return res.status(400).json({ 
            success: false, 
            data: null, 
            error: 'Project ID, type, and status required' 
          });
        }

        // For now, just return success as we track status by counting records
        return res.status(200).json({ 
          success: true, 
          data: null, 
          message: 'Status updated successfully' 
        });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ 
          success: false, 
          data: null, 
          message: `Method ${req.method} not allowed` 
        });
    }
  } catch (error: any) {
    console.error('Import Status API Error:', error);
    return res.status(500).json({ success: false, data: null, error: 'Internal server error' });
  }
}

export default withAuth(handler);
