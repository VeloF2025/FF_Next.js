/**
 * Staff Photo Comparison API
 * POST /api/staff/[staffId]/compare-photos - Compare ID photo with profile photo
 *
 * Uses Qwen3-VL model via VLLM to analyze face similarity
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { VLM_API_URL, VLM_CHAT_ENDPOINT, VLM_MODEL } from '@/lib/vlm';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffPhotoCompareAPI');

// VLLM endpoint for Qwen3-VL

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }

  const { staffId } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return apiResponse.badRequest(res, 'Staff ID is required');
  }

  try {
    // Get staff with photo URLs
    const [staff] = await sql`
      SELECT id, name, id_photo_url, profile_photo_url
      FROM staff
      WHERE id = ${staffId}
    `;

    if (!staff) {
      return apiResponse.notFound(res, 'Staff member not found');
    }

    if (!staff.id_photo_url) {
      return apiResponse.badRequest(res, 'No ID photo available. Upload an SA ID or Passport document first.');
    }

    if (!staff.profile_photo_url) {
      return apiResponse.badRequest(res, 'No profile photo available. Upload a profile photo first.');
    }

    // Check if VLLM is available (use /v1/models endpoint)
    let vllmAvailable = false;
    try {
      const healthCheck = await fetch(`${VLM_API_URL}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      vllmAvailable = healthCheck.ok;
    } catch {
      logger.warn('VLLM endpoint not available');
    }

    if (!vllmAvailable) {
      return res.status(503).json({
        error: 'Face comparison service unavailable. Please try again later.',
        details: 'VLLM server is not responding'
      });
    }

    // Call VLLM to compare photos using Qwen3-VL
    logger.info('Comparing photos', { staffId, name: staff.name });

    const comparisonResult = await comparePhotosWithVLLM(
      staff.id_photo_url,
      staff.profile_photo_url
    );

    // Update staff record with comparison result
    await sql`
      UPDATE staff
      SET
        photo_match_score = ${comparisonResult.score},
        photo_verified_at = NOW(),
        updated_at = NOW()
      WHERE id = ${staffId}
    `;

    logger.info('Photo comparison complete', {
      staffId,
      score: comparisonResult.score,
      isMatch: comparisonResult.isMatch
    });

    return res.status(200).json({
      success: true,
      matchScore: comparisonResult.score,
      isMatch: comparisonResult.isMatch,
      analysis: comparisonResult.analysis,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Photo comparison failed', { staffId, error: errorMessage });
    return res.status(500).json({ error: 'Failed to compare photos', message: errorMessage });
  }
}

interface ComparisonResult {
  score: number;
  isMatch: boolean;
  analysis: string;
}

async function comparePhotosWithVLLM(
  idPhotoUrl: string,
  profilePhotoUrl: string
): Promise<ComparisonResult> {
  const prompt = `You are a face verification system. Compare the two photos provided and determine if they show the same person.

Photo 1 (ID Photo): This is extracted from an official identity document.
Photo 2 (Profile Photo): This is a recent photo of the person.

Analyze the following facial features:
1. Face shape and structure
2. Eye shape, color, and spacing
3. Nose shape and size
4. Mouth and lip shape
5. Ear shape (if visible)
6. Overall facial proportions

Provide your response in the following exact JSON format:
{
  "score": <number from 0 to 100 indicating match confidence>,
  "isMatch": <true if score >= 80, false otherwise>,
  "analysis": "<brief explanation of key similarities or differences>"
}

Only respond with the JSON, no additional text.`;

  const response = await fetch(`${VLM_API_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: idPhotoUrl } },
            { type: 'image_url', image_url: { url: profilePhotoUrl } },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(60000), // 60 second timeout for VLM inference
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VLLM request failed: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Parse JSON response from VLM
  try {
    // Extract JSON from response (VLM might add extra text)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in VLM response');
    }

    const result = JSON.parse(jsonMatch[0]);
    return {
      score: Math.min(100, Math.max(0, Number(result.score) || 0)),
      isMatch: result.isMatch === true || result.score >= 80,
      analysis: String(result.analysis || 'Analysis not available'),
    };
  } catch (parseError) {
    logger.warn('Failed to parse VLM response', { content, error: parseError });
    // Return a default response if parsing fails
    return {
      score: 0,
      isMatch: false,
      analysis: 'Unable to analyze photos. Please try again.',
    };
  }
}

export default withAuth(withArcjetProtection(handler, aj));
