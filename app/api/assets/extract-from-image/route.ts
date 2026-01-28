/**
 * Asset Label Extraction API
 * POST /api/assets/extract-from-image
 *
 * Extract asset information from equipment labels using VLM
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractAssetFromLabel, extractAssetFromImageUrl } from '@/modules/assets/services/assetVlmService';
import { log } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow 60s for VLM processing

// Request validation schema
const ExtractRequestSchema = z.object({
  imageBase64: z.string().optional(),
  imageUrl: z.string().url().optional(),
}).refine(
  (data) => data.imageBase64 || data.imageUrl,
  { message: 'Either imageBase64 or imageUrl is required' }
);

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await req.json();

    // Validate request
    const validation = ExtractRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { imageBase64, imageUrl } = validation.data;

    log.info('[API] Asset label extraction started', {
      hasBase64: !!imageBase64,
      hasUrl: !!imageUrl,
    });

    // Extract from base64 or URL
    const extraction = imageBase64
      ? await extractAssetFromLabel(imageBase64)
      : await extractAssetFromImageUrl(imageUrl!);

    const duration = Date.now() - startTime;

    if (!extraction.success) {
      log.warn('[API] Asset extraction failed', {
        error: extraction.error,
        duration,
      });
      return NextResponse.json(
        { error: extraction.error || 'Extraction failed', extraction },
        { status: 422 }
      );
    }

    log.info('[API] Asset extraction successful', {
      manufacturer: extraction.manufacturer,
      model: extraction.model,
      hasSerial: !!extraction.serialNumber,
      confidence: extraction.confidence,
      duration,
    });

    return NextResponse.json({
      success: true,
      extraction,
      processingTime: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error('[API] Asset extraction error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      duration,
    });
    return NextResponse.json(
      { error: 'Failed to extract asset information' },
      { status: 500 }
    );
  }
}
