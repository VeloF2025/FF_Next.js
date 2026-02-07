import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // TODO: Fetch actual data from database
    const mockData = [
      ['Task ID', 'Title', 'Type', 'Status', 'Technician', 'Location', 'Scheduled Date'],
      ['TASK-001', 'Install Fiber Cable - Section A', 'installation', 'pending', 'John Smith', '123 Main St, Johannesburg', new Date().toISOString()],
      ['TASK-002', 'Repair Junction Box - Site B', 'maintenance', 'in_progress', 'Jane Doe', '456 Park Ave, Cape Town', new Date().toISOString()],
      ['TASK-003', 'Network Testing - Zone C', 'inspection', 'pending', 'Mike Johnson', '789 Tech Road, Durban', new Date(Date.now() + 86400000).toISOString()]
    ];

    // Convert to CSV
    const csv = mockData.map(row => row.join(',')).join('\n');
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="field-report-${new Date().toISOString().split('T')[0]}.csv"`);
    
    res.status(200).send(csv);
  } catch (error) {
    log.error('Error exporting data', { error });
    res.status(500).json({ error: 'Failed to export data' });
  }
}

export default withAuth(handler);