// LiveKit Webhooks API
// Handle LiveKit server events

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { WebhookReceiver } from 'livekit-server-sdk';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

// Disable body parsing for webhook signature verification
export const config = {
    api: {
        bodyParser: false,
    },
};

async function getRawBody(req: NextApiRequest): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const rawBody = await getRawBody(req);
        const authHeader = req.headers.authorization as string;

        // Verify webhook signature
        const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
        const event = await receiver.receive(rawBody, authHeader);

        console.log('LiveKit webhook event:', event.event);

        // Handle different event types
        switch (event.event) {
            case 'room_started':
                if (event.room) {
                    await sql`
                        UPDATE livekit_meetings 
                        SET started_at = NOW() 
                        WHERE room_name = ${event.room.name}
                    `;
                }
                break;

            case 'room_finished':
                if (event.room) {
                    await sql`
                        UPDATE livekit_meetings 
                        SET ended_at = NOW() 
                        WHERE room_name = ${event.room.name}
                    `;
                }
                break;

            case 'participant_joined':
                console.log(`Participant ${event.participant?.name} joined room ${event.room?.name}`);
                break;

            case 'participant_left':
                console.log(`Participant ${event.participant?.name} left room ${event.room?.name}`);
                break;

            case 'egress_ended':
                if (event.egressInfo) {
                    // Get file results from egress info
                    const fileResults = event.egressInfo.fileResults;
                    const recordingPath = fileResults && fileResults.length > 0
                        ? fileResults[0].filename
                        : null;

                    if (recordingPath) {
                        await sql`
                            UPDATE livekit_meetings 
                            SET recording_path = ${recordingPath} 
                            WHERE room_name = ${event.egressInfo.roomName}
                        `;
                    }
                }
                break;

            default:
                console.log('Unhandled event:', event.event);
        }

        return res.status(200).json({ received: true });
    } catch (error: any) {
        console.error('Webhook error:', error);
        return res.status(400).json({ error: error.message });
    }
}

export default withAuth(getRawBody);
