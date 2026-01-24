// Recordings API - List and Delete recordings
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

const RECORDINGS_PATH = '/opt/recordings';

interface Recording {
    id: string;
    filename: string;
    roomName: string;
    createdAt: string;
    size: number;
    duration?: number;
    url: string;
}

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    // GET - List all recordings
    if (req.method === 'GET') {
        try {
            // Check if directory exists
            if (!fs.existsSync(RECORDINGS_PATH)) {
                return res.status(200).json({ recordings: [] });
            }

            const files = fs.readdirSync(RECORDINGS_PATH);
            const recordings: Recording[] = [];

            for (const file of files) {
                if (file.endsWith('.mp4')) {
                    const filePath = path.join(RECORDINGS_PATH, file);
                    const stats = fs.statSync(filePath);

                    // Parse room name from filename (format: roomname-timestamp.mp4)
                    const roomName = file.split('-').slice(0, -1).join('-').replace(/-\d{4}-\d{2}-\d{2}T.*/, '');

                    // Try to get duration from JSON manifest
                    const manifestFile = files.find(f => f.endsWith('.json') && file.includes(f.replace('.json', '').substring(0, 10)));
                    let duration: number | undefined;

                    if (manifestFile) {
                        try {
                            const manifest = JSON.parse(fs.readFileSync(path.join(RECORDINGS_PATH, manifestFile), 'utf-8'));
                            if (manifest.file_results?.[0]?.duration) {
                                duration = Math.round(manifest.file_results[0].duration / 1e9); // Convert nanoseconds to seconds
                            }
                        } catch (e) {
                            // Ignore manifest parsing errors
                        }
                    }

                    recordings.push({
                        id: file.replace('.mp4', ''),
                        filename: file,
                        roomName: roomName || 'Unknown Room',
                        createdAt: stats.mtime.toISOString(),
                        size: stats.size,
                        duration,
                        url: `/recordings/${file}`,
                    });
                }
            }

            // Sort by date, newest first
            recordings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            return res.status(200).json({ recordings });
        } catch (error: any) {
            console.error('Error listing recordings:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // DELETE - Delete a recording
    if (req.method === 'DELETE') {
        try {
            const { filename } = req.query;

            if (!filename || typeof filename !== 'string') {
                return res.status(400).json({ error: 'Filename is required' });
            }

            // Security: Prevent path traversal
            if (filename.includes('..') || filename.includes('/')) {
                return res.status(400).json({ error: 'Invalid filename' });
            }

            const filePath = path.join(RECORDINGS_PATH, filename);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'Recording not found' });
            }

            fs.unlinkSync(filePath);

            // Also delete manifest if exists
            const manifestPath = filePath.replace('.mp4', '.json');
            if (fs.existsSync(manifestPath)) {
                fs.unlinkSync(manifestPath);
            }

            return res.status(200).json({ success: true });
        } catch (error: any) {
            console.error('Error deleting recording:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
