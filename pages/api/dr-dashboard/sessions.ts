/**
 * DR Sessions API - Fetches real data from BOSS VPS
 * Returns list of DRs with photos for the DR Photo Review page
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
// BOSS VPS API base URL (migrated to Velocity Server)
const BOSS_API_URL = process.env.BOSS_VPS_API_URL || 'http://100.96.203.105:8001';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
    }

    try {
        log.debug('drSessions', { action: 'fetch', url: `${BOSS_API_URL}/api/photos` });

        // Fetch photos from BOSS VPS API
        const response = await fetch(`${BOSS_API_URL}/api/photos`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            throw new Error(`BOSS VPS API returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        log.debug('drSessions', { action: 'fetchComplete', totalDrs: data.total_drs });

        // Transform BOSS API response to DR sessions format
        const sessions = (data.drs || []).map((dr: any) => {
            const photoCount = dr.photos?.length || 0;
            const currentStep = photoCount;

            // Determine status based on photo count
            let status: string;
            if (photoCount === 0) {
                status = 'pending';
            } else if (photoCount < 11) {
                status = 'in_progress';
            } else {
                status = 'completed';
            }

            return {
                dr_number: dr.dr_number,
                project: dr.project || 'VPS',
                status,
                current_step: currentStep,
                steps_completed: photoCount,
                needs_review: photoCount >= 11,
                photo_count: photoCount,
            };
        });

        return res.status(200).json(sessions);
    } catch (error) {
        log.error('drSessions', { action: 'fetch', error });
        return res.status(502).json({
            error: 'Failed to fetch DR sessions from BOSS VPS',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

export default withAuth(handler);
