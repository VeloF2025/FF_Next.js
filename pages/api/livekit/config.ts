// LiveKit Config API
// Returns client-safe configuration

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
    }

    // Return the public LiveKit URL for client connection (wss://)
    // Use NEXT_PUBLIC_LIVEKIT_URL for external/client connections
    const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL || '';

    return apiResponse.success(res, { serverUrl, configured: !!serverUrl });
}

export default withAuth(handler);
