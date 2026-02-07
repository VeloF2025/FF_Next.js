import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '../../../lib/db.mjs';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

type SummarData = {
  success: boolean;
  data: any;
  message?: string;
  error?: string;
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SummarData>
) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check authentication
  if (!userId) {
    return res.status(401).json({ success: false, data: null, message: 'Unauthorized' });
  }

  try {
    const { projectId } = req.query;

    switch (req.method) {
      case 'GET':
        if (projectId) {
          // Get summary for a specific project
          const [sowImports, project] = await Promise.all([
            sql`
              SELECT 
                import_type,
                COUNT(*) as count,
                SUM(total_records) as total_records,
                SUM(processed_records) as processed_records,
                MAX(imported_at) as last_import
              FROM sow_imports
              WHERE project_id = ${projectId}
              GROUP BY import_type
            `,
            sql`SELECT project_name FROM projects WHERE id = ${projectId}`
          ]);

          const summary = {
            projectId,
            projectName: project[0]?.project_name || 'Unknown Project',
            poles: {
              total: sowImports.find(s => s.import_type === 'poles')?.total_records || 0,
              processed: sowImports.find(s => s.import_type === 'poles')?.processed_records || 0
            },
            drops: {
              total: sowImports.find(s => s.import_type === 'drops')?.total_records || 0,
              processed: sowImports.find(s => s.import_type === 'drops')?.processed_records || 0
            },
            fibre: {
              total: sowImports.find(s => s.import_type === 'fibre')?.total_records || 0,
              processed: sowImports.find(s => s.import_type === 'fibre')?.processed_records || 0
            },
            lastImport: sowImports[0]?.last_import || null,
            generatedAt: new Date().toISOString()
          };

          return res.status(200).json({ success: true, data: summary });
        } else {
          // Get overall summary
          const overallSummary = await sql`
            SELECT 
              COUNT(DISTINCT project_id) as total_projects,
              COUNT(*) as total_imports,
              SUM(total_records) as total_records,
              SUM(processed_records) as processed_records,
              import_type,
              status
            FROM sow_imports
            GROUP BY import_type, status
          `;

          const summary = {
            totalProjects: overallSummary[0]?.total_projects || 0,
            totalImports: overallSummary.reduce((acc, curr) => acc + parseInt(curr.total_imports || 0), 0),
            totalRecords: overallSummary.reduce((acc, curr) => acc + parseInt(curr.total_records || 0), 0),
            processedRecords: overallSummary.reduce((acc, curr) => acc + parseInt(curr.processed_records || 0), 0),
            byType: {
              poles: overallSummary.filter(s => s.import_type === 'poles'),
              drops: overallSummary.filter(s => s.import_type === 'drops'),
              fibre: overallSummary.filter(s => s.import_type === 'fibre')
            },
            generatedAt: new Date().toISOString()
          };

          return res.status(200).json({ success: true, data: summary });
        }

      default:
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ 
          success: false, 
          data: null, 
          message: `Method ${req.method} not allowed` 
        });
    }
  } catch (error: any) {
    log.error('Summary API Error', { error });
    return res.status(500).json({ success: false, data: null, error: 'Internal server error' });
  }
}

export default withAuth(handler);
