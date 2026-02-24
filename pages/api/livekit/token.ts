// LiveKit Token Generation API
// Generates access tokens for participants to join rooms

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { generateToken } from '@/modules/livekit/services/livekitService';
import type { TokenRequest, TokenResponse } from '@/modules/livekit/types/livekit.types';

async function handler(
    req: NextApiRequest,
    res: NextApiResponse<TokenResponse>
) {
    // Only allow POST
    if (req.method !== 'POST') {
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
    }

    try {
        const { roomName, participantName, participantIdentity } = req.body as TokenRequest;

        if (!roomName || !participantName) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'roomName and participantName are required');
        }

        const result = await generateToken({
            roomName,
            participantName,
            participantIdentity,
        });

        if (!result.success) {
            return apiResponse.internalError(res, new Error(result.error));
        }

        return apiResponse.success(res, result);
    } catch (error: any) {
        log.error('Token API error', { error });
        return apiResponse.internalError(res, error);
    }
}

export default withAuth(handler);
