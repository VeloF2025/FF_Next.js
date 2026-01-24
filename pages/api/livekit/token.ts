// LiveKit Token Generation API
// Generates access tokens for participants to join rooms

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { generateToken } from '@/modules/livekit/services/livekitService';
import type { TokenRequest, TokenResponse } from '@/modules/livekit/types/livekit.types';

async function handler(
    req: NextApiRequest,
    res: NextApiResponse<TokenResponse>
) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { roomName, participantName, participantIdentity } = req.body as TokenRequest;

        if (!roomName || !participantName) {
            return res.status(400).json({
                success: false,
                error: 'roomName and participantName are required'
            });
        }

        const result = await generateToken({
            roomName,
            participantName,
            participantIdentity,
        });

        if (!result.success) {
            return res.status(500).json(result);
        }

        return res.status(200).json(result);
    } catch (error: any) {
        console.error('Token API error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

export default withAuth(handler);
