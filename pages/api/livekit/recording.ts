// LiveKit Recording API
// Start/stop room recording

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { startRecording, stopRecording } from '@/modules/livekit/services/livekitService';
import type { RecordingRequest, RecordingResponse } from '@/modules/livekit/types/livekit.types';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
    req: NextApiRequest,
    res: NextApiResponse<RecordingResponse>
) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { roomName, action } = req.body as RecordingRequest;

        if (!roomName || !action) {
            return res.status(400).json({
                success: false,
                error: 'roomName and action are required'
            });
        }

        if (action === 'start') {
            const result = await startRecording(roomName);

            if (result.success) {
                // Update database with recording info
                await sql`
          UPDATE livekit_meetings 
          SET recording_path = ${result.recordingPath}
          WHERE room_name = ${roomName}
        `;
            }

            return res.status(200).json(result);
        }

        if (action === 'stop') {
            const { egressId } = req.body;

            if (!egressId) {
                return res.status(400).json({
                    success: false,
                    error: 'egressId is required for stop action'
                });
            }

            const result = await stopRecording(egressId);
            return res.status(200).json(result);
        }

        return res.status(400).json({ success: false, error: 'Invalid action' });
    } catch (error: any) {
        log.error('Recording API error', { error });
        return res.status(500).json({ success: false, error: error.message });
    }
}

export default withAuth(handler);
