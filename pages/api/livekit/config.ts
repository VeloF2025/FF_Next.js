// LiveKit Config API
// Returns client-safe configuration

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Return the public LiveKit URL for client connection (wss://)
    // Use NEXT_PUBLIC_LIVEKIT_URL for external/client connections
    const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL || '';

    return res.status(200).json({
        serverUrl,
        configured: !!serverUrl,
    });
}

export default withAuth(withErrorHandler(handler));
