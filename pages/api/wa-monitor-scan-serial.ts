/**
 * WA Monitor Serial Scan API
 * POST /api/wa-monitor-scan-serial
 *
 * Records equipment serial scans during installation (QA Steps 8 & 9)
 * Part of the 4-stage Site Stock Tracking System
 *
 * Workflow:
 * 1. Technician scans barcode at customer site
 * 2. System validates serial exists and is issued to technician
 * 3. Creates stock_consumptions record
 * 4. Updates stock_serials status to 'installed'
 * 5. Updates qa_photo_reviews with serial + consumption link
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/modules/wa-monitor/lib/apiResponse';
import {
  scanSerialService,
  type ScanSerialRequest,
} from '@/modules/wa-monitor/services/scanSerialService';
import { isValidDropNumber } from '@/modules/wa-monitor/types/wa-monitor.types';
import { log } from '@/lib/logger';

// ==================== TYPES ====================

interface ScanSerialSuccessResponse {
  success: true;
  data: {
    consumptionId: string;
    serialStatus: 'installed';
    dropUpdated: boolean;
    qaReviewUpdated: boolean;
  };
}

interface ScanSerialErrorResponse {
  success: false;
  error: {
    code: 'SERIAL_NOT_FOUND' | 'SERIAL_NOT_ISSUED' | 'ALREADY_INSTALLED' | 'VALIDATION_ERROR';
    message: string;
  };
}

type ApiResponse = ScanSerialSuccessResponse | ScanSerialErrorResponse;

// ==================== VALIDATION ====================

interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

function validateRequest(body: unknown): ValidationResult {
  const errors: Record<string, string> = {};

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: { body: 'Request body is required' } };
  }

  const request = body as Partial<ScanSerialRequest>;

  // Required fields
  if (!request.qaReviewId) {
    errors.qaReviewId = 'qaReviewId is required';
  }

  if (!request.dropNumber) {
    errors.dropNumber = 'dropNumber is required';
  } else if (!isValidDropNumber(request.dropNumber)) {
    errors.dropNumber = 'dropNumber must be in format DR######## (e.g., DR12345678)';
  }

  if (!request.serialNumber) {
    errors.serialNumber = 'serialNumber is required';
  } else if (request.serialNumber.trim() === '') {
    errors.serialNumber = 'serialNumber cannot be empty';
  }

  if (request.stepNumber === undefined) {
    errors.stepNumber = 'stepNumber is required';
  } else if (request.stepNumber !== 8 && request.stepNumber !== 9) {
    errors.stepNumber = 'stepNumber must be 8 (ONT) or 9 (UPS)';
  }

  if (!request.scanTimestamp) {
    errors.scanTimestamp = 'scanTimestamp is required';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

// ==================== HANDLER ====================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse | { error: string }>
): Promise<void> {
  // Only allow POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    return;
  }

  try {
    // Validate request
    const validation = validateRequest(req.body);
    if (!validation.valid) {
      const errorMessage = Object.entries(validation.errors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join('; ');

      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: errorMessage,
        },
      });
      return;
    }

    const request = req.body as ScanSerialRequest;

    // Validate serial exists and has correct status
    const validationResult = await scanSerialService.validateSerial(
      request.serialNumber,
      request.technicianId
    );

    if (!validationResult.valid) {
      const statusCode = validationResult.errorCode === 'SERIAL_NOT_FOUND' ? 404 : 400;
      res.status(statusCode).json({
        success: false,
        error: {
          code: validationResult.errorCode!,
          message: validationResult.errorMessage!,
        },
      });
      return;
    }

    // Record the scan (creates consumption, updates serial, updates qa_review)
    const result = await scanSerialService.recordScan({
      ...request,
      serialId: validationResult.serial!.id,
      stockItemId: validationResult.serial!.stockItemId,
    });

    log.info('Serial scan recorded', {
      dropNumber: request.dropNumber,
      serialNumber: request.serialNumber,
      stepNumber: request.stepNumber,
      consumptionId: result.consumptionId,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    log.error('Serial scan error', { error });

    res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error instanceof Error ? `Internal error: ${error.message}` : 'Internal server error',
      },
    });
  }
}
