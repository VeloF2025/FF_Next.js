// LiveKit Service Layer
// Server-side utilities for LiveKit operations

import { AccessToken, RoomServiceClient, EgressClient } from 'livekit-server-sdk';
import type {
    CreateRoomRequest,
    CreateRoomResponse,
    TokenRequest,
    TokenResponse,
    RecordingResponse,
    LiveKitRoom
} from '../types/livekit.types';
import { log } from '@/lib/logger';

// Environment variables
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const EGRESS_OUTPUT_PATH = process.env.EGRESS_OUTPUT_PATH || '/opt/recordings';

// Validate configuration
function validateConfig(): boolean {
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        log.error('LiveKit configuration missing. Required: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET', {}, 'livekitService');
        return false;
    }
    return true;
}

// Get HTTP URL from WebSocket URL for API calls
function getHttpUrl(): string {
    return LIVEKIT_URL.replace('ws://', 'http://').replace('wss://', 'https://');
}

// Room Service Client (lazy initialization)
let roomServiceClient: RoomServiceClient | null = null;
function getRoomServiceClient(): RoomServiceClient {
    if (!roomServiceClient) {
        roomServiceClient = new RoomServiceClient(getHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    }
    return roomServiceClient;
}

// Egress Client (lazy initialization)
let egressClient: EgressClient | null = null;
function getEgressClient(): EgressClient {
    if (!egressClient) {
        egressClient = new EgressClient(getHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    }
    return egressClient;
}

/**
 * Generate a unique room name
 */
export function generateRoomName(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `ff-${timestamp}-${random}`;
}

/**
 * Generate an access token for a participant
 */
export async function generateToken(request: TokenRequest): Promise<TokenResponse> {
    try {
        if (!validateConfig()) {
            return { success: false, error: 'LiveKit not configured' };
        }

        const { roomName, participantName, participantIdentity } = request;
        const identity = participantIdentity || participantName.toLowerCase().replace(/\s+/g, '-');

        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity,
            name: participantName,
            ttl: '6h', // 6 hour validity
        });

        token.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
        });

        const jwt = await token.toJwt();
        return { success: true, token: jwt };
    } catch (error: any) {
        log.error('Error generating token', { error }, 'livekitService');
        return { success: false, error: error.message };
    }
}

/**
 * Create a new LiveKit room
 */
export async function createRoom(request: CreateRoomRequest): Promise<CreateRoomResponse> {
    try {
        if (!validateConfig()) {
            return { success: false, error: 'LiveKit not configured' };
        }

        const roomName = request.name || generateRoomName();
        const client = getRoomServiceClient();

        const room = await client.createRoom({
            name: roomName,
            emptyTimeout: request.emptyTimeout || 300, // 5 minutes
            maxParticipants: request.maxParticipants || 50,
            metadata: JSON.stringify({ title: request.title }),
        });

        const liveKitRoom: LiveKitRoom = {
            name: room.name,
            title: request.title,
            createdAt: new Date(),
            numParticipants: 0,
            maxParticipants: request.maxParticipants || 50,
            emptyTimeout: request.emptyTimeout || 300,
        };

        return { success: true, room: liveKitRoom };
    } catch (error: any) {
        log.error('Error creating room', { error }, 'livekitService');
        return { success: false, error: error.message };
    }
}

/**
 * List all active rooms
 */
export async function listRooms(): Promise<LiveKitRoom[]> {
    try {
        if (!validateConfig()) {
            return [];
        }

        const client = getRoomServiceClient();
        const rooms = await client.listRooms();

        return rooms.map(room => {
            let title = room.name;
            try {
                const metadata = JSON.parse(room.metadata || '{}');
                title = metadata.title || room.name;
            } catch { }

            return {
                name: room.name,
                title,
                createdAt: new Date(Number(room.creationTime) * 1000),
                numParticipants: room.numParticipants,
                maxParticipants: room.maxParticipants,
            };
        });
    } catch (error: any) {
        log.error('Error listing rooms', { error }, 'livekitService');
        return [];
    }
}

/**
 * Delete a room
 */
export async function deleteRoom(roomName: string): Promise<boolean> {
    try {
        if (!validateConfig()) {
            return false;
        }

        const client = getRoomServiceClient();
        await client.deleteRoom(roomName);
        return true;
    } catch (error: any) {
        log.error('Error deleting room', { error }, 'livekitService');
        return false;
    }
}

/**
 * Start recording a room
 * Note: Recording requires Egress service to be deployed on VPS
 */
export async function startRecording(roomName: string): Promise<RecordingResponse> {
    try {
        if (!validateConfig()) {
            return { success: false, error: 'LiveKit not configured' };
        }

        const client = getEgressClient();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${roomName}-${timestamp}.mp4`;
        const filepath = `${EGRESS_OUTPUT_PATH}/${filename}`;

        // Use file output with filepath
        const egress = await client.startRoomCompositeEgress(
            roomName,
            { filepath }
        );

        return {
            success: true,
            egressId: egress.egressId,
            recordingPath: filepath,
        };
    } catch (error: any) {
        log.error('Error starting recording', { error }, 'livekitService');
        return { success: false, error: error.message };
    }
}

/**
 * Stop recording
 */
export async function stopRecording(egressId: string): Promise<RecordingResponse> {
    try {
        if (!validateConfig()) {
            return { success: false, error: 'LiveKit not configured' };
        }

        const client = getEgressClient();
        await client.stopEgress(egressId);

        return { success: true, egressId };
    } catch (error: any) {
        log.error('Error stopping recording', { error }, 'livekitService');
        return { success: false, error: error.message };
    }
}

/**
 * Get LiveKit WebSocket URL for client connection
 */
export function getLiveKitUrl(): string {
    return LIVEKIT_URL;
}
