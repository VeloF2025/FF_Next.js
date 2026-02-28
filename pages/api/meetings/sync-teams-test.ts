import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { fetchRecentCallRecords } from '@/lib/graph/call-records';
import { processMeetingFromCallRecord } from '@/lib/graph/meeting-processor';

/**
 * POST /api/meetings/sync-teams-test
 * Synchronous diagnostic — processes up to 3 call records and returns results inline.
 * Admin only. Remove after testing.
 */
async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const authReq = req as AuthenticatedNextApiRequest;
  if (authReq.user?.role !== 'super_admin' && authReq.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const results: Array<{ id: string; type: string; result: string; meetingId?: number; error?: string }> = [];

  try {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const records = await fetchRecentCallRecords(since);

    // Only process first 3 group calls for testing
    const groupCalls = records.filter(r => r.type === 'groupCall').slice(0, 3);

    for (const record of groupCalls) {
      try {
        const meetingId = await processMeetingFromCallRecord(record.id);
        results.push({ id: record.id, type: record.type, result: 'ok', meetingId });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        results.push({ id: record.id, type: record.type, result: 'error', error: msg });
      }
    }

    return res.status(200).json({
      totalRecords: records.length,
      groupCalls: records.filter(r => r.type === 'groupCall').length,
      peerToPeer: records.filter(r => r.type === 'peerToPeer').length,
      tested: results,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: msg, results });
  }
}

export default withAuth(handler);
