/**
 * Extract Face Photo from ID Document API
 * POST /api/staff/[staffId]/extract-id-photo
 *
 * Uses Qwen3-VL model via VLLM to identify and extract the face photo
 * from an SA ID or Passport document image.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import sharp from 'sharp';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('ExtractIdPhotoAPI');

// VLLM endpoint for Qwen3-VL
const VLLM_ENDPOINT = process.env.VLLM_ENDPOINT || 'http://100.96.203.105:8100';
const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { staffId } = req.query;
  const { documentUrl, force } = req.body;

  if (!staffId || typeof staffId !== 'string') {
    return res.status(400).json({ error: 'Staff ID is required' });
  }

  if (!documentUrl) {
    return res.status(400).json({ error: 'Document URL is required' });
  }

  try {
    // Check if staff already has an ID photo (don't replace unless forced)
    const [existingStaff] = await sql`
      SELECT id_photo_url FROM staff WHERE id = ${staffId}
    `;

    if (existingStaff?.id_photo_url && !force) {
      logger.info('Staff already has ID photo, skipping extraction (use force=true to replace)', {
        staffId,
        existingPhotoUrl: existingStaff.id_photo_url
      });
      return res.status(200).json({
        success: true,
        skipped: true,
        message: 'ID photo already exists. Use force=true to replace.',
        existingPhotoUrl: existingStaff.id_photo_url,
      });
    }

    // Check if VLLM is available
    let vllmAvailable = false;
    try {
      const healthCheck = await fetch(`${VLLM_ENDPOINT}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      vllmAvailable = healthCheck.ok;
    } catch {
      logger.warn('VLLM endpoint not available');
    }

    if (!vllmAvailable) {
      return res.status(503).json({
        error: 'Face extraction service unavailable. Please try again later.',
        details: 'VLLM server is not responding'
      });
    }

    logger.info('Extracting face from ID document', { staffId, documentUrl });

    // Step 1: Download image and get dimensions first
    const imageResponse = await fetch(documentUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download document image: ${imageResponse.status}`);
    }
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const metadata = await sharp(imageBuffer).metadata();
    const imgWidth = metadata.width || 1000;
    const imgHeight = metadata.height || 650;

    logger.info(`Image dimensions: ${imgWidth}x${imgHeight}`);

    // Step 2: Use VLM to get face bounding box
    const boundingBox = await getFaceBoundingBox(documentUrl, imgWidth, imgHeight);

    if (!boundingBox) {
      return res.status(400).json({
        error: 'Could not detect a face in the document image.',
        details: 'Please ensure the document image is clear and contains a visible photo.'
      });
    }

    logger.info('Face detected', { staffId, boundingBox });

    // Convert percentage-based bounding box to pixels
    const cropX = Math.round((boundingBox.x / 100) * imgWidth);
    const cropY = Math.round((boundingBox.y / 100) * imgHeight);
    const cropWidth = Math.round((boundingBox.width / 100) * imgWidth);
    const cropHeight = Math.round((boundingBox.height / 100) * imgHeight);

    // Ensure crop region is within bounds
    const safeX = Math.max(0, Math.min(cropX, imgWidth - 1));
    const safeY = Math.max(0, Math.min(cropY, imgHeight - 1));
    const safeWidth = Math.min(cropWidth, imgWidth - safeX);
    const safeHeight = Math.min(cropHeight, imgHeight - safeY);

    logger.info('Cropping face region', {
      original: { width: imgWidth, height: imgHeight },
      crop: { x: safeX, y: safeY, width: safeWidth, height: safeHeight }
    });

    // Step 4: Crop the face region
    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left: safeX, top: safeY, width: safeWidth, height: safeHeight })
      .resize(300, 400, { fit: 'cover' }) // Standardize size for comparison
      .jpeg({ quality: 90 })
      .toBuffer();

    // Step 5: Upload cropped face to VF Storage
    const formData = new FormData();
    const blob = new Blob([croppedBuffer], { type: 'image/jpeg' });
    formData.append('file', blob, `id-photo-${staffId}.jpg`);

    const uploadResponse = await fetch(`${VF_STORAGE_URL}/upload/staff/photos`, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Failed to upload cropped photo: ${errorText}`);
    }

    const uploadResult = await uploadResponse.json();
    // Storage API may return wrong domain - transform to direct URL
    let facePhotoUrl = uploadResult.url;
    if (facePhotoUrl.includes('vf.fibreflow.app')) {
      facePhotoUrl = facePhotoUrl.replace('https://vf.fibreflow.app', VF_STORAGE_URL);
    }

    logger.info('Face photo uploaded', { staffId, facePhotoUrl });

    // Step 6: Update staff record with the extracted face photo URL
    await sql`
      UPDATE staff
      SET id_photo_url = ${facePhotoUrl}, updated_at = NOW()
      WHERE id = ${staffId}
    `;

    return res.status(200).json({
      success: true,
      idPhotoUrl: facePhotoUrl,
      boundingBox,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Face extraction failed', { staffId, error: errorMessage });
    return res.status(500).json({ error: 'Failed to extract face photo', message: errorMessage });
  }
}

async function getFaceBoundingBox(imageUrl: string, imgWidth: number, imgHeight: number): Promise<BoundingBox | null> {
  const prompt = `Find the HUMAN FACE in this ID document image.

Look for the passport-style photograph showing a person's HEAD and FACE with:
- Eyes, nose, and mouth visible
- Usually a formal front-facing portrait
- Located on the LEFT side of ID cards

IGNORE these (they are NOT the face photo):
- Signatures (handwriting)
- Fingerprints
- Barcodes or QR codes
- Text or numbers

Return the bounding box of JUST THE FACE PHOTO as percentages (0-100):
- x: distance from LEFT edge as percentage
- y: distance from TOP edge as percentage
- width: photo width as percentage of image width
- height: photo height as percentage of image height

For SA ID cards, the face is typically around x=5, y=20, width=25, height=45.

Return JSON only:
{"found": true, "x": 5, "y": 20, "width": 25, "height": 45}

If no face photo found: {"found": false}`;

  const response = await fetch(`${VLLM_ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'Qwen/Qwen3-VL-8B-Instruct',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VLLM request failed: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  try {
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in VLM response', { content });
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);
    logger.info(`VLM raw response: ${content.substring(0, 500)}`);
    logger.info(`VLM parsed: ${JSON.stringify(result)}`);

    if (!result.found) {
      return null;
    }

    let x = Number(result.x) || 0;
    let y = Number(result.y) || 0;
    let width = Number(result.width) || 30;
    let height = Number(result.height) || 40;

    // If any value > 100, VLM likely returned pixel coordinates
    // Use actual image dimensions for conversion
    if (x > 100 || y > 100 || width > 100 || height > 100) {
      logger.warn(`VLM returned pixel values instead of percentages, converting using ${imgWidth}x${imgHeight}...`);
      x = (x / imgWidth) * 100;
      y = (y / imgHeight) * 100;
      width = (width / imgWidth) * 100;
      height = (height / imgHeight) * 100;
    }

    // If converted values are too small, VLM probably gave garbage - use defaults
    if (width < 10 || height < 15) {
      logger.warn(`VLM bounding box too small (${width.toFixed(1)}x${height.toFixed(1)}%), using defaults`);
      // SA Smart ID cards have photo on the RIGHT side around 65%
      x = 65;
      y = 20;
      width = 30;
      height = 55;
    }

    // Note: SA Smart ID cards (newer credit-card size) have photo on RIGHT side
    // Old green ID books had photo on left - but Smart IDs are different

    // Clamp values to valid percentage range
    const boundingBox = {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
      width: Math.max(10, Math.min(50, width)),
      height: Math.max(15, Math.min(70, height)),
    };

    logger.info(`Parsed bounding box: ${JSON.stringify(boundingBox)}`);
    return boundingBox;
  } catch (parseError) {
    logger.warn('Failed to parse VLM response', { content, error: parseError });
    return null;
  }
}

export default withArcjetProtection(handler, aj);
