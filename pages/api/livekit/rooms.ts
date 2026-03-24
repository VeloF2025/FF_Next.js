// LiveKit Rooms API
// CRUD operations for LiveKit rooms

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import {
    createRoom,
    listRooms,
    deleteRoom,
    generateToken,
    generateRoomName
} from '@/modules/livekit/services/livekitService';
import type { CreateRoomRequest, LiveKitRoom } from '@/modules/livekit/types/livekit.types';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

interface RoomsResponse {
    success: boolean;
    rooms?: LiveKitRoom[];
    room?: LiveKitRoom;
    token?: string;
    error?: string;
}

async function handler(
    req: NextApiRequest,
    res: NextApiResponse<RoomsResponse>
) {
    // GET - List rooms
    if (req.method === 'GET') {
        try {
            const rooms = await listRooms();
            return res.status(200).json({ success: true, rooms });
        } catch (error: any) {
            log.error('List rooms error', { error });
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST - Create room
    if (req.method === 'POST') {
        try {
            const { title, emptyTimeout, maxParticipants } = req.body as CreateRoomRequest;

            if (!title) {
                return res.status(400).json({ success: false, error: 'title is required' });
            }

            const roomName = generateRoomName();
            const result = await createRoom({
                name: roomName,
                title,
                emptyTimeout,
                maxParticipants,
            });

            if (!result.success || !result.room) {
                return res.status(500).json({ success: false, error: result.error });
            }

            // Save to database
            await sql`
        INSERT INTO livekit_meetings (room_name, title, created_at)
        VALUES (${roomName}, ${title}, NOW())
      `;

            // Generate token for the creator
            const tokenResult = await generateToken({
                roomName,
                participantName: 'Host',
            });

            return res.status(200).json({
                success: true,
                room: result.room,
                token: tokenResult.token,
            });
        } catch (error: any) {
            log.error('Create room error', { error });
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // DELETE - Delete room
    if (req.method === 'DELETE') {
        try {
            const { roomName } = req.query;

            if (!roomName || typeof roomName !== 'string') {
                return res.status(400).json({ success: false, error: 'roomName is required' });
            }

            const deleted = await deleteRoom(roomName);

            if (deleted) {
                // Update database
                await sql`
          UPDATE livekit_meetings 
          SET ended_at = NOW() 
          WHERE room_name = ${roomName}
        `;
            }

            return res.status(200).json({ success: deleted });
        } catch (error: any) {
            log.error('Delete room error', { error });
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST', 'DELETE']);
}

export default withAuth(handler);
