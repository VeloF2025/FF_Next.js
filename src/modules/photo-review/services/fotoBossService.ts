/**
 * BOSS API Integration Service
 * Fetches AI evaluation results from BOSS VPS API
 * BOSS auto-evaluates photos when they're fetched from 1Map
 */

import { EvaluationResult } from '../types';
import { log } from '@/lib/logger';

const BOSS_API_URL = process.env.BOSS_VPS_API_URL || 'http://72.61.197.178:8001';

export class BossEvaluationError extends Error {
    constructor(
        message: string,
        public readonly code?: string,
        public readonly details?: any
    ) {
        super(message);
        this.name = 'BossEvaluationError';
    }
}

/**
 * Fetch evaluation results from BOSS API
 * BOSS automatically evaluates photos when they're fetched from 1Map
 * @param drNumber - DR number (e.g., "DR1856291")
 * @returns Evaluation results from BOSS
 */
export async function fetchBossEvaluation(drNumber: string): Promise<EvaluationResult | null> {
    try {
        log.info('BossService', `Fetching evaluation from BOSS API for ${drNumber}`);

        // Try to get QA status first (includes detailed results)
        const qaResponse = await fetch(`${BOSS_API_URL}/api/qa/status/${drNumber}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (qaResponse.ok) {
            const qaData = await qaResponse.json();

            if (qaData.status === 'completed' || qaData.status === 'failed') {
                log.info('BossService', `Found completed evaluation for ${drNumber}`);
                return convertBossToEvaluationResult(qaData);
            }

            if (qaData.status === 'in_progress' || qaData.status === 'pending') {
                log.info('BossService', `Evaluation in progress for ${drNumber}`);
                return null; // Evaluation not ready yet
            }
        }

        // Fallback: try evaluations endpoint
        const evalResponse = await fetch(`${BOSS_API_URL}/api/evaluations/${drNumber}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (evalResponse.ok) {
            const evalData = await evalResponse.json();
            if (evalData && evalData.dr_number) {
                log.info('BossService', `Found evaluation via evaluations endpoint for ${drNumber}`);
                return convertBossToEvaluationResult(evalData);
            }
        }

        log.info('BossService', `No evaluation found for ${drNumber} in BOSS`);
        return null;

    } catch (error) {
        log.error('BossService', `Failed to fetch BOSS evaluation: ${error}`);
        throw new BossEvaluationError(
            `Failed to fetch evaluation from BOSS for ${drNumber}`,
            'FETCH_ERROR',
            error
        );
    }
}

/**
 * Convert BOSS API response to our EvaluationResult format
 */
function convertBossToEvaluationResult(bossData: any): EvaluationResult {
    const drNumber = bossData.dr_number;
    const results = bossData.results || [];

    // Map BOSS photo-level results to our step-based format
    // BOSS evaluates individual photos, we need to aggregate by step type
    const stepMap = new Map<string, any>();

    for (const result of results) {
        const photoType = result.photo_type;
        const existing = stepMap.get(photoType);

        // Keep the best result for each photo type
        if (!existing || result.scores.overall > existing.scores.overall) {
            stepMap.set(photoType, result);
        }
    }

    // Map photo types to our QA steps
    const photoTypeToStep: Record<string, { number: number; name: string; label: string }> = {
        'ph_prop': { number: 1, name: 'house_photo', label: 'House Photo' },
        'ph_drop': { number: 2, name: 'cable_span', label: 'Cable Span from Pole' },
        'ph_outs': { number: 2, name: 'cable_span', label: 'Cable Span from Pole' },
        'ph_hm_ln': { number: 3, name: 'cable_entry_outside', label: 'Cable Entry Outside' },
        'ph_hm_en': { number: 4, name: 'cable_entry_inside', label: 'Cable Entry Inside' },
        'ph_wall': { number: 5, name: 'wall_installation', label: 'Wall for Installation' },
        'ph_cbl_r': { number: 6, name: 'ont_back_and_barcode', label: 'ONT Back & Barcode' },
        'ph_powm1': { number: 7, name: 'power_meter', label: 'Power Meter Reading' },
        'ph_powm2': { number: 7, name: 'power_meter', label: 'Power Meter Reading' },
        'ph_ups': { number: 8, name: 'ups_serial', label: 'UPS Serial Number' },
        'ph_after': { number: 9, name: 'final_installation', label: 'Final Installation' },
        'ph_bl': { number: 10, name: 'ont_lights_and_dr_label', label: 'Green Lights & DR Label' },
        'ph_conn1': { number: 6, name: 'ont_back_and_barcode', label: 'ONT Back & Barcode' },
    };

    const stepResults = [];
    const processedSteps = new Set<number>();

    // Convert BOSS results to our step format
    for (const [photoType, result] of stepMap.entries()) {
        const stepInfo = photoTypeToStep[photoType];
        if (stepInfo && !processedSteps.has(stepInfo.number)) {
            processedSteps.add(stepInfo.number);

            const passed = result.status === 'pass';
            const score = result.scores.overall / 10; // BOSS uses 0-100, we use 0-10

            stepResults.push({
                step_number: stepInfo.number,
                step_name: stepInfo.name,
                step_label: stepInfo.label,
                passed: passed,
                score: score,
                comment: result.summary || result.issues?.join('. ') || 'No comment',
            });
        }
    }

    // Fill in missing steps with "NO PHOTO FOUND"
    const allSteps = [
        { number: 1, name: 'house_photo', label: 'House Photo' },
        { number: 2, name: 'cable_span', label: 'Cable Span from Pole' },
        { number: 3, name: 'cable_entry_outside', label: 'Cable Entry Outside' },
        { number: 4, name: 'cable_entry_inside', label: 'Cable Entry Inside' },
        { number: 5, name: 'wall_installation', label: 'Wall for Installation' },
        { number: 6, name: 'ont_back_and_barcode', label: 'ONT Back & Barcode' },
        { number: 7, name: 'power_meter', label: 'Power Meter Reading' },
        { number: 8, name: 'ups_serial', label: 'UPS Serial Number' },
        { number: 9, name: 'final_installation', label: 'Final Installation' },
        { number: 10, name: 'ont_lights_and_dr_label', label: 'Green Lights & DR Label' },
    ];

    for (const step of allSteps) {
        if (!processedSteps.has(step.number)) {
            stepResults.push({
                step_number: step.number,
                step_name: step.name,
                step_label: step.label,
                passed: false,
                score: 0,
                comment: `NO PHOTO FOUND for ${step.label}`,
            });
        }
    }

    // Sort by step number
    stepResults.sort((a, b) => a.step_number - b.step_number);

    // Calculate overall stats
    const passedCount = stepResults.filter(s => s.passed).length;
    const avgScore = stepResults.reduce((sum, s) => sum + s.score, 0) / stepResults.length;
    const passRate = passedCount / stepResults.length;
    const overallStatus = passRate >= 0.7 ? 'PASS' : 'FAIL';

    return {
        dr_number: drNumber,
        overall_status: overallStatus,
        average_score: Math.round(avgScore * 10) / 10,
        total_steps: stepResults.length,
        passed_steps: passedCount,
        step_results: stepResults,
        feedback_sent: false,
        evaluation_date: bossData.completed_at ? new Date(bossData.completed_at) : new Date(),
        markdown_report: `BOSS Evaluation: ${passedCount}/${stepResults.length} steps passed (${Math.round(passRate * 100)}%)`,
    };
}

/**
 * Check if BOSS has evaluation results for a DR
 */
export async function hasBossEvaluation(drNumber: string): Promise<boolean> {
    try {
        const evaluation = await fetchBossEvaluation(drNumber);
        return evaluation !== null;
    } catch (error) {
        return false;
    }
}
