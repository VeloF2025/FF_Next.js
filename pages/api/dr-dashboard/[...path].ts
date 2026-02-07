/**
 * API Proxy for DR Dashboard Backend
 * Forwards requests to 100.96.203.105:8082 (Tailscale)
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
const BACKEND_URL = process.env.DR_DASHBOARD_API_URL || 'http://100.96.203.105:8082';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { path } = req.query;

    // Reconstruct the path
    const pathSegments = Array.isArray(path) ? path : [path];
    const targetPath = pathSegments.join('/');

    // Build the full URL with query params
    const queryString = new URLSearchParams();
    Object.entries(req.query).forEach(([key, value]) => {
        if (key !== 'path' && typeof value === 'string') {
            queryString.append(key, value);
        }
    });

    const queryPart = queryString.toString() ? `?${queryString.toString()}` : '';
    const targetUrl = `${BACKEND_URL}/api/v1/dr-dashboard/${targetPath}${queryPart}`;

    try {
        const fetchOptions: RequestInit = {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        // Include body for POST/PUT/PATCH requests
        if (['POST', 'PUT', 'PATCH'].includes(req.method || '') && req.body) {
            fetchOptions.body = JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl, fetchOptions);

        // Check if response is an image
        const contentType = response.headers.get('content-type') || '';

        if (contentType.startsWith('image/')) {
            // Forward image binary data
            res.setHeader('Content-Type', contentType);
            const buffer = await response.arrayBuffer();
            res.send(Buffer.from(buffer));
            return;
        }

        // Forward JSON response
        const data = await response.json().catch(() => null);

        res.status(response.status).json(data || { error: 'Empty response' });
    } catch (error) {
        log.error('DR Dashboard API proxy error', { error });
        res.status(502).json({
            error: 'Failed to connect to DR Dashboard backend',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

// Allow larger payloads for image uploads
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
}

export default withAuth(handler);
