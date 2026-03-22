/**
 * Shared types for the OCR Preview pipeline
 * PRD-033: OCR-First Document Upload Flow
 */

import type { ValidationResult } from '@/services/staff/documentValidationService';
import type { ExtractedField } from './vlmExtractionService';

/** HTTP response shape returned by /api/documents-ocr-preview */
export interface OcrPreviewResponse {
  success: boolean;
  classification: {
    documentType: string;
    confidence: number;
    displayName: string;
    topGuesses: Array<{
      documentType: string;
      confidence: number;
      displayName: string;
    }>;
  };
  extractedFields: Record<string, ExtractedField>;
  rawText: string;
  tierUsed: 'tesseract' | 'paddleocr' | 'ocrspace' | 'gemini' | 'qwen3-vl';
  processingTimeMs: number;
  validation?: ValidationResult;
}
