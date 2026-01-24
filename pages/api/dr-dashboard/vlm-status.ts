/**
 * VLM Status Check API
 * Verifies the FiberTime VLM service is accessible
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
const VLM_URL = process.env.VLM_API_URL || 'http://100.96.203.105:8100';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const response = await fetch(`${VLM_URL}/v1/models`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            return res.status(200).json({
                status: 'offline',
                message: 'VLM service not responding correctly',
                url: VLM_URL,
            });
        }

        const data = await response.json();
        const models = data.data || [];
        const drVerifierAvailable = models.some((m: { id: string }) =>
            m.id === 'dr-verifier' || m.id.includes('dr-verifier')
        );

        return res.status(200).json({
            status: 'online',
            url: VLM_URL,
            models_available: models.map((m: { id: string }) => m.id),
            dr_verifier_ready: drVerifierAvailable,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return res.status(200).json({
            status: 'offline',
            message: 'Cannot connect to VLM service',
            url: VLM_URL,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

export default withAuth(handler);
