/**
 * Photos API Endpoint
 * Fetches photos directly from BOSS VPS API
 * Returns list of DRs with photos for the foto-review page
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import type { DropRecord, Photo } from '@/modules/photo-review/types';
import { Pool } from 'pg';

// Create database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// BOSS VPS API base URL (migrated to Velocity Server)
const BOSS_API_URL = process.env.BOSS_VPS_API_URL || 'http://100.96.203.105:8001';

// Photo step label mapping (simplified from BOSS filenames)
const STEP_LABELS: Record<string, string> = {
  house_photo: 'House Photo',
  cable_from_pole: 'Cable From Pole',
  cable_entry_outside: 'Cable Entry Outside',
  cable_entry_inside: 'Cable Entry Inside',
  wall_for_installation: 'Wall For Installation',
  ont_back_after_install: 'ONT Back After Install',
  power_meter_reading: 'Power Meter Reading',
  ont_barcode: 'ONT Barcode',
  ups_serial: 'UPS Serial',
  final_installation: 'Final Installation',
  green_lights: 'Green Lights',
  customer_signature: 'Customer Signature',
};

/**
 * Extract human-readable label from BOSS filename
 * Example: "step1_house_photo_20251206_171524.jpg" → "House Photo"
 */
function extractStepLabel(filename: string): string {
  // Remove step number prefix and timestamp suffix
  const match = filename.match(/step\d+_(.+?)_\d{8}/);
  if (match && match[1]) {
    const stepKey = match[1];
    return STEP_LABELS[stepKey] || stepKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  return filename;
}

/**
 * Construct proxied photo URL to bypass CORS
 */
function getProxiedPhotoUrl(drNumber: string, filename: string): string {
  const bossUrl = `${BOSS_API_URL}/api/photo/${drNumber}/${filename}`;
  return `/api/foto/photo-proxy?url=${encodeURIComponent(bossUrl)}`;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { project, dr_number } = req.query;

    console.log(`[FOTO API] Fetching photos from BOSS VPS: ${BOSS_API_URL}/api/photos`);

    // Fetch photos from BOSS VPS API
    const response = await fetch(`${BOSS_API_URL}/api/photos`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`BOSS VPS API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    console.log(`[FOTO API] Received ${data.total_drs} DRs with ${data.total_photos} photos from BOSS VPS`);

    // Fetch evaluation data from database
    const evaluationQuery = `
      SELECT 
        dr_number,
        overall_status,
        average_score,
        feedback_sent,
        evaluation_date,
        created_at
      FROM foto_ai_reviews
      ORDER BY evaluation_date DESC
    `;

    const evaluationResult = await pool.query(evaluationQuery);
    const evaluationMap = new Map(
      evaluationResult.rows.map((row: any) => [row.dr_number, row])
    );

    console.log(`[FOTO API] Found ${evaluationResult.rows.length} evaluations in database`);

    // Transform BOSS API response to our DropRecord format
    const dropRecords: DropRecord[] = (data.drs || []).map((dr: any) => {
      const drNumber = dr.dr_number;
      const evaluation = evaluationMap.get(drNumber);

      // Convert BOSS photo format to our Photo format
      const photos: Photo[] = (dr.photos || []).map((photo: any, index: number) => ({
        id: `${drNumber}-${index}`,
        url: getProxiedPhotoUrl(drNumber, photo.filename),
        step: photo.type || photo.filename, // BOSS uses "type" field
        stepLabel: extractStepLabel(photo.filename),
        timestamp: photo.modified || new Date().toISOString(),
        filename: photo.filename,
      }));

      return {
        dr_number: drNumber,
        project: dr.project || 'Unknown',
        installation_date: photos[0]?.timestamp || new Date().toISOString(),
        customer_name: '', // Not available from BOSS API
        address: '',
        pole_number: '',
        photos: photos,
        evaluated: !!evaluation,
        evaluation_date: evaluation?.evaluation_date?.toISOString(),
        feedback_sent: evaluation?.feedback_sent || false,
        overall_status: evaluation?.overall_status,
      };
    });

    // Apply filters if provided
    let filteredRecords = dropRecords;

    if (project && typeof project === 'string') {
      filteredRecords = filteredRecords.filter(dr =>
        dr.project.toLowerCase() === project.toLowerCase()
      );
    }

    if (dr_number && typeof dr_number === 'string') {
      filteredRecords = filteredRecords.filter(dr =>
        dr.dr_number === dr_number
      );
    }

    // Sort by evaluation date (most recent first), then by DR number
    filteredRecords.sort((a, b) => {
      // Evaluated drops first
      if (a.evaluated && !b.evaluated) return -1;
      if (!a.evaluated && b.evaluated) return 1;

      // Both evaluated: sort by evaluation date (newest first)
      if (a.evaluated && b.evaluated) {
        const dateA = a.evaluation_date ? new Date(a.evaluation_date).getTime() : 0;
        const dateB = b.evaluation_date ? new Date(b.evaluation_date).getTime() : 0;
        return dateB - dateA;
      }

      // Both unevaluated: sort by DR number
      return a.dr_number.localeCompare(b.dr_number);
    });

    console.log(`[FOTO API] Returning ${filteredRecords.length} DRs after filtering and sorting`);

    return res.status(200).json({
      success: true,
      data: filteredRecords,
    });
  } catch (error) {
    console.error('[FOTO API] Error fetching photos from BOSS VPS:', error);
    return res.status(500).json({
      error: 'Failed to fetch photos',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
