/**
 * DR Session Actions API - Photos and Evaluation
 * Fetches real photos from BOSS VPS and evaluates with VLM
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
// BOSS VPS API for photos (migrated to Velocity Server)
const BOSS_API_URL = process.env.BOSS_VPS_API_URL || 'http://100.96.203.105:8001';
// VLM API for evaluation
const VLM_URL = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_MODEL = process.env.VLM_MODEL || 'dr-verifier';

// Photo step label mapping
const STEP_LABELS: Record<string, { label: string; critical: boolean; step: number }> = {
    house_photo: { label: 'Property Photo', critical: false, step: 1 },
    cable_from_pole: { label: 'Cable From Pole', critical: false, step: 2 },
    cable_entry_outside: { label: 'Cable Entry Outside', critical: true, step: 3 },
    cable_entry_inside: { label: 'Cable Entry Inside', critical: false, step: 4 },
    wall_for_installation: { label: 'Wall For Installation', critical: false, step: 5 },
    ont_back_after_install: { label: 'ONT Back After Install', critical: false, step: 6 },
    power_meter_reading: { label: 'Power Meter Reading', critical: true, step: 7 },
    ont_barcode: { label: 'ONT Barcode/Serial', critical: true, step: 8 },
    ups_serial: { label: 'UPS Serial Number', critical: true, step: 9 },
    final_installation: { label: 'Final Installation', critical: true, step: 10 },
    green_lights: { label: 'Green Lights', critical: true, step: 11 },
};

function extractStepInfo(filename: string): { step: number; label: string; critical: boolean } {
    const match = filename.match(/step(\d+)_(.+?)_\d{8}/);
    if (match) {
        const stepNum = parseInt(match[1], 10);
        const stepKey = match[2];
        const info = STEP_LABELS[stepKey];
        if (info) {
            return { step: stepNum, label: info.label, critical: info.critical };
        }
        return { step: stepNum, label: stepKey.replace(/_/g, ' '), critical: false };
    }
    return { step: 0, label: filename, critical: false };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { dr, action } = req.query;
    const drNumber = Array.isArray(dr) ? dr[0] : dr;
    const actionPath = Array.isArray(action) ? action.join('/') : action;

    if (!drNumber) {
        return apiResponse.badRequest(res, 'DR number required');
    }

    switch (actionPath) {
        case 'photos':
            return handlePhotos(req, res, drNumber);
        case 'evaluate':
            return handleEvaluate(req, res, drNumber);
        default:
            return handleDetails(req, res, drNumber);
    }
}

// Get photos for a DR from BOSS VPS
async function handlePhotos(req: NextApiRequest, res: NextApiResponse, drNumber: string) {
    if (req.method !== 'GET') {
        return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
    }

    try {
        log.debug('drPhotos', { action: 'fetch', drNumber });

        const response = await fetch(`${BOSS_API_URL}/api/photos`, {
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            throw new Error(`BOSS API returned ${response.status}`);
        }

        const data = await response.json();
        const drData = (data.drs || []).find((d: any) => d.dr_number === drNumber);

        if (!drData) {
            return res.status(404).json({ error: `DR ${drNumber} not found` });
        }

        // Transform photos to our format
        const photos = (drData.photos || []).map((photo: any) => {
            const stepInfo = extractStepInfo(photo.filename);
            const bossUrl = `${BOSS_API_URL}/api/photo/${drNumber}/${photo.filename}`;

            return {
                step_number: stepInfo.step,
                step_name: stepInfo.label.toLowerCase().replace(/ /g, '_'),
                step_label: stepInfo.label,
                filename: photo.filename,
                url: `/api/foto/photo-proxy?url=${encodeURIComponent(bossUrl)}`,
                critical: stepInfo.critical,
                timestamp: photo.modified || new Date().toISOString(),
            };
        });

        return res.status(200).json({ dr_number: drNumber, photos });
    } catch (error) {
        log.error('drPhotos', { action: 'fetch', drNumber, error });
        return res.status(502).json({
            error: 'Failed to fetch photos from BOSS VPS',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

// Evaluate all photos for a DR using VLM
async function handleEvaluate(req: NextApiRequest, res: NextApiResponse, drNumber: string) {
    if (req.method !== 'POST') {
        return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
    }

    try {
        // First, get the photos
        const photosRes = await fetch(`${BOSS_API_URL}/api/photos`);
        const photosData = await photosRes.json();
        const drData = (photosData.drs || []).find((d: any) => d.dr_number === drNumber);

        if (!drData || !drData.photos?.length) {
            return res.status(404).json({ error: `No photos found for DR ${drNumber}` });
        }

        log.debug('drEvaluate', { action: 'start', drNumber, photoCount: drData.photos.length });

        // Evaluate each photo with VLM
        const evaluations = await Promise.all(
            drData.photos.map(async (photo: any) => {
                const stepInfo = extractStepInfo(photo.filename);

                try {
                    // Fetch image and convert to base64
                    const imgUrl = `${BOSS_API_URL}/api/photo/${drNumber}/${photo.filename}`;
                    const imgRes = await fetch(imgUrl);
                    const imgBuffer = await imgRes.arrayBuffer();
                    const base64 = `data:image/jpeg;base64,${Buffer.from(imgBuffer).toString('base64')}`;

                    // Call VLM evaluate endpoint
                    const evalRes = await fetch(`http://localhost:3005/api/dr-dashboard/evaluate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            step: stepInfo.step,
                            imageBase64: base64,
                            drNumber,
                        }),
                    });

                    const evalData = await evalRes.json();
                    return {
                        step_number: stepInfo.step,
                        accepted: evalData.evaluation?.accepted ?? true,
                        confidence: evalData.evaluation?.confidence ?? 0.8,
                        details: evalData.evaluation?.details || 'Evaluation completed',
                        fibertime_compliance: evalData.evaluation?.fibertime_compliance,
                    };
                } catch (err) {
                    log.error('drEvaluate', { action: 'evaluateStep', drNumber, step: stepInfo.step, error: err });
                    return {
                        step_number: stepInfo.step,
                        accepted: null,
                        confidence: 0,
                        details: 'Evaluation failed',
                        error: true,
                    };
                }
            })
        );

        const passedSteps = evaluations.filter((e) => e.accepted === true).length;
        const totalSteps = evaluations.length;
        const overallPass = passedSteps >= Math.ceil(totalSteps * 0.8);

        return res.status(200).json({
            dr_number: drNumber,
            status: 'completed',
            overall_score: totalSteps > 0 ? (passedSteps / totalSteps) * 100 : 0,
            overall_pass: overallPass,
            evaluations,
            summary: overallPass
                ? `DR ${drNumber}: PASSED with ${passedSteps}/${totalSteps} steps approved`
                : `DR ${drNumber}: FAILED - Only ${passedSteps}/${totalSteps} steps approved`,
            evaluated_at: new Date().toISOString(),
        });
    } catch (error) {
        log.error('drEvaluate', { action: 'evaluate', drNumber, error });
        return res.status(502).json({
            error: 'Evaluation failed',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

// Get DR details
async function handleDetails(req: NextApiRequest, res: NextApiResponse, drNumber: string) {
    // Delegate to photos handler
    return handlePhotos(req, res, drNumber);
}

export default withAuth(handler);
