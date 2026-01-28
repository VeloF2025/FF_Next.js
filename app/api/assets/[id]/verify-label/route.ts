/**
 * Asset Label Verification API
 * POST /api/assets/[id]/verify-label
 *
 * Verify asset details by scanning equipment label
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAssetLabel } from '@/modules/assets/services/assetVerificationService';
import { log } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow 60s for VLM processing

// Request validation schema
const VerifyRequestSchema = z.object({
  imageBase64: z.string().optional(),
  imageUrl: z.string().url().optional(),
}).refine(
  (data) => data.imageBase64 || data.imageUrl,
  { message: 'Either imageBase64 or imageUrl is required' }
);

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const startTime = Date.now();
  const { id: assetId } = await context.params;

  try {
    const body = await req.json();

    // Validate request
    const validation = VerifyRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { imageBase64, imageUrl } = validation.data;

    log.info('[API] Asset verification started', {
      assetId,
      hasBase64: !!imageBase64,
      hasUrl: !!imageUrl,
    });

    // Get image as base64
    let base64Data = imageBase64;
    if (!base64Data && imageUrl) {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        return NextResponse.json(
          { error: `Failed to fetch image: ${response.status}` },
          { status: 400 }
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      base64Data = Buffer.from(arrayBuffer).toString('base64');
    }

    if (!base64Data) {
      return NextResponse.json(
        { error: 'No image data provided' },
        { status: 400 }
      );
    }

    // Perform verification
    const result = await verifyAssetLabel(assetId, base64Data);

    const duration = Date.now() - startTime;

    if (result.error) {
      log.warn('[API] Asset verification failed', {
        assetId,
        error: result.error,
        duration,
      });
      return NextResponse.json(
        { error: result.error, result },
        { status: 422 }
      );
    }

    log.info('[API] Asset verification complete', {
      assetId,
      verified: result.verified,
      mismatchCount: result.mismatches.length,
      confidence: result.confidence,
      duration,
    });

    return NextResponse.json({
      success: true,
      ...result,
      processingTime: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error('[API] Asset verification error', {
      assetId,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration,
    });
    return NextResponse.json(
      { error: 'Failed to verify asset' },
      { status: 500 }
    );
  }
}
