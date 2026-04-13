/**
 * DR Photo Review Service
 * API client for backend at localhost:8082
 */

import type {
    DRSession,
    DRStepPhoto,
    PhotoEvaluation,
    DREvaluationResult,
    VLMStatus,
} from '../types';

// Use local API proxy to avoid CORS issues
const API_BASE = '/api/dr-dashboard';
const DEFAULT_PROJECT = 'VPS';

/**
 * Fetch all DR sessions with photos
 */
export async function fetchSessions(): Promise<DRSession[]> {
    const response = await fetch(`${API_BASE}/sessions`);

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch sessions' }));
        throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Fetch photos for a specific DR
 */
export async function fetchDRPhotos(drNumber: string, project = DEFAULT_PROJECT): Promise<DRStepPhoto[]> {
    const response = await fetch(
        `${API_BASE}/sessions/${encodeURIComponent(drNumber)}/photos?project=${project}`
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch photos' }));
        throw new Error(error.message || `HTTP ${response.status}`);
    }

    const data = await response.json();

    // Map photos to include full URLs and step info
    return (data.photos || data || []).map((photo: { step_number?: number; filename?: string; timestamp?: unknown; evaluation?: unknown }, index: number) => {
        const stepNumber = photo.step_number || index + 1;
        const stepInfo = getStepInfo(stepNumber);

        return {
            step_number: stepNumber,
            step_name: stepInfo.name,
            step_label: stepInfo.label,
            filename: photo.filename,
            url: `${API_BASE}/photos/${encodeURIComponent(drNumber)}/${encodeURIComponent(photo.filename ?? '')}`,
            critical: stepInfo.critical,
            timestamp: photo.timestamp,
            evaluation: photo.evaluation,
        };
    });
}

/**
 * Get step info from step number
 */
function getStepInfo(stepNumber: number): { name: string; label: string; critical: boolean } {
    const steps = [
        { step: 1, name: 'property_photo', label: 'Property Photo', critical: false },
        { step: 2, name: 'cable_from_pole', label: 'Cable from Pole', critical: false },
        { step: 3, name: 'cable_entry_outside', label: 'Cable Entry Outside', critical: true },
        { step: 4, name: 'cable_entry_inside', label: 'Cable Entry Inside', critical: false },
        { step: 5, name: 'wall_for_installation', label: 'Wall for Installation', critical: false },
        { step: 6, name: 'ont_back_after_install', label: 'ONT Back After Install', critical: false },
        { step: 7, name: 'power_meter_reading', label: 'Power Meter Reading', critical: true },
        { step: 8, name: 'ont_barcode_serial', label: 'ONT Barcode/Serial', critical: true },
        { step: 9, name: 'ups_serial_number', label: 'UPS Serial Number', critical: true },
        { step: 10, name: 'final_installation', label: 'Final Installation', critical: true },
        { step: 11, name: 'green_lights', label: 'Green Lights', critical: true },
    ];

    const step = steps.find((s) => s.step === stepNumber);
    return step || { name: `step_${stepNumber}`, label: `Step ${stepNumber}`, critical: false };
}

/**
 * Evaluate a single photo with AI using FiberTime VLM
 */
export async function evaluatePhoto(
    drNumber: string,
    filename: string,
    stepNumber: number,
    housingType?: string
): Promise<PhotoEvaluation> {
    // First, fetch the image and convert to base64
    const imageUrl = getPhotoUrl(drNumber, filename);
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
        throw new Error('Failed to fetch image for evaluation');
    }
    const imageBlob = await imageResponse.blob();
    const imageBase64 = await blobToBase64(imageBlob);

    // Call VLM evaluation endpoint
    const response = await fetch(`${API_BASE}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            step: stepNumber,
            imageBase64,
            housingType,
            drNumber,
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Evaluation failed' }));
        throw new Error(error.message || `HTTP ${response.status}`);
    }

    const result = await response.json();
    return {
        step_number: stepNumber,
        accepted: result.evaluation?.accepted ?? null,
        confidence: result.evaluation?.confidence ?? 0,
        details: result.evaluation?.details ?? result.evaluation?.raw_response ?? '',
        fibertime_compliance: result.evaluation?.fibertime_compliance,
        issues: result.evaluation?.issues,
    };
}

/**
 * Convert blob to base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Evaluate all photos for a DR
 */
export async function evaluateAllPhotos(drNumber: string): Promise<DREvaluationResult> {
    const response = await fetch(
        `${API_BASE}/sessions/${encodeURIComponent(drNumber)}/evaluate`,
        { method: 'POST' }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Evaluation failed' }));
        throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Get VLM (AI) service status
 */
export async function getVLMStatus(): Promise<VLMStatus> {
    try {
        const response = await fetch(`${API_BASE}/vlm-status`);

        if (!response.ok) {
            return { online: false, model: 'dr-verifier', error: `HTTP ${response.status}` };
        }

        const data = await response.json();
        return {
            online: data.status === 'online',
            model: 'dr-verifier',
            models_available: data.models_available,
            dr_verifier_ready: data.dr_verifier_ready,
        };
    } catch (error) {
        return {
            online: false,
            model: 'dr-verifier',
            error: error instanceof Error ? error.message : 'Connection failed',
        };
    }
}

/**
 * Get photo URL for display
 */
export function getPhotoUrl(drNumber: string, filename: string): string {
    return `${API_BASE}/photos/${encodeURIComponent(drNumber)}/${encodeURIComponent(filename)}`;
}
