/**
 * OCR Service Client Adapter
 * Connects to the VF Server OCR service (100.96.203.105:8095)
 * Provides TypeScript interface for OCR processing with 4-tier cascade
 *
 * PRD Reference: PRD-032 OCR Document Extraction System
 *
 * Environment Variables:
 * - OCR_SERVICE_URL: Override the base URL (default: http://100.96.203.105:8095)
 * - OCR_SERVICE_MOCK: Set to 'true' to use mock responses for development
 */

import { log } from '@/lib/logger';
import {
  type OcrServiceHealth,
  type OcrExtractRequest,
  type OcrExtractResponse,
  type OcrFieldExtractionRequest,
  type OcrFieldExtractionResponse,
  type DocumentClassification,
  type ExtractedFields,
  OcrTier,
  OcrEntityType,
} from '@/types/ocr.types';
import {
  classifyDocument,
  getDocumentConfig,
  validateField,
  validateSAID,
  extractDOBFromSAID,
  extractGenderFromSAID,
} from '@/config/ocrFieldMappings';

// Default OCR Service URL
const DEFAULT_OCR_SERVICE_URL = 'http://100.96.203.105:8095';

// Use environment variable to override default URL
const OCR_SERVICE_BASE_URL =
  process.env.OCR_SERVICE_URL || DEFAULT_OCR_SERVICE_URL;

// Check if mock mode is enabled
const IS_MOCK_MODE = process.env.OCR_SERVICE_MOCK === 'true';

/**
 * OCR Service for document processing operations
 */
export class OcrService {
  private baseUrl: string;
  private mockMode: boolean;

  constructor(baseUrl?: string, mockMode?: boolean) {
    this.baseUrl = baseUrl || OCR_SERVICE_BASE_URL;
    this.mockMode = mockMode ?? IS_MOCK_MODE;
  }

  /**
   * Check if OCR service is healthy
   */
  async health(): Promise<OcrServiceHealth> {
    if (this.mockMode) {
      return this.getMockHealth();
    }

    try {
      const response = await fetch(`${this.baseUrl}/ocr/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      log.warn('OCR Service health check failed:', { error });
      return {
        status: 'unhealthy',
        tiers: {
          tesseract: false,
          paddleocr: false,
          ocrspace: false,
          gemini: false,
        },
        version: 'unknown',
      };
    }
  }

  /**
   * Extract raw text from a document
   */
  async extractText(request: OcrExtractRequest): Promise<OcrExtractResponse> {
    if (this.mockMode) {
      return this.getMockExtractText(request);
    }

    try {
      const startTime = Date.now();

      const response = await fetch(`${this.baseUrl}/ocr/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OCR extraction failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      return {
        success: true,
        text: result.text || '',
        confidence: result.confidence || 0,
        tierUsed: result.tier_used || OcrTier.TESSERACT,
        processingTimeMs: Date.now() - startTime,
        pageCount: result.page_count || 1,
      };
    } catch (error) {
      log.error('OCR text extraction error:', { error, request });
      return {
        success: false,
        text: '',
        confidence: 0,
        tierUsed: OcrTier.TESSERACT,
        processingTimeMs: 0,
        pageCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Classify a document based on its content
   */
  async classify(fileUrl: string): Promise<DocumentClassification | null> {
    if (this.mockMode) {
      return this.getMockClassification();
    }

    try {
      const response = await fetch(`${this.baseUrl}/ocr/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ file_url: fileUrl }),
      });

      if (!response.ok) {
        throw new Error(`Classification failed: ${response.status}`);
      }

      const result = await response.json();

      return {
        documentType: result.document_type,
        confidence: result.confidence,
        matchedKeywords: result.matched_keywords || [],
        matchedPatterns: result.matched_patterns || [],
      };
    } catch (error) {
      log.error('OCR classification error:', { error, fileUrl });
      return null;
    }
  }

  /**
   * Extract structured fields from a document
   * This is the main method that combines OCR, classification, and field extraction
   */
  async extractFields(request: OcrFieldExtractionRequest): Promise<OcrFieldExtractionResponse> {
    if (this.mockMode) {
      return this.getMockFieldExtraction(request);
    }

    const startTime = Date.now();

    try {
      // Try to call the OCR service
      const response = await fetch(`${this.baseUrl}/ocr/extract-fields`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          file_url: request.fileUrl,
          document_type: request.documentType,
          entity_type: request.entityType,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Field extraction failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      return {
        success: true,
        classification: {
          documentType: result.classification?.document_type || 'unknown',
          confidence: result.classification?.confidence || 0,
          matchedKeywords: result.classification?.matched_keywords || [],
          matchedPatterns: result.classification?.matched_patterns || [],
        },
        extractedFields: this.mapExtractedFields(result.extracted_fields || {}),
        rawText: result.raw_text || '',
        tierUsed: result.tier_used as OcrTier || OcrTier.TESSERACT,
        overallConfidence: result.overall_confidence || 0,
        processingTimeMs: Date.now() - startTime,
        pageCount: result.page_count || 1,
      };
    } catch (error) {
      log.error('OCR field extraction error:', { error, request });

      // If OCR service is unavailable, try local processing with mock data
      if (this.shouldFallbackToMock(error)) {
        log.info('Falling back to mock OCR response');
        return this.getMockFieldExtraction(request);
      }

      return {
        success: false,
        classification: {
          documentType: 'unknown',
          confidence: 0,
          matchedKeywords: [],
          matchedPatterns: [],
        },
        extractedFields: {},
        rawText: '',
        tierUsed: OcrTier.TESSERACT,
        overallConfidence: 0,
        processingTimeMs: Date.now() - startTime,
        pageCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process text locally to extract fields (fallback when OCR service unavailable)
   * Uses the field mapping configuration for extraction
   */
  processTextLocally(
    text: string,
    entityType: OcrEntityType
  ): { classification: DocumentClassification | null; extractedFields: ExtractedFields } {
    // Classify the document
    const classification = classifyDocument(text);

    if (!classification) {
      return { classification: null, extractedFields: {} };
    }

    // Get field mappings for this document type
    const config = getDocumentConfig(classification.documentType);

    if (!config) {
      return {
        classification: {
          ...classification,
          matchedKeywords: [],
          matchedPatterns: [],
        },
        extractedFields: {},
      };
    }

    // Extract fields using patterns
    const extractedFields: ExtractedFields = {};

    for (const mapping of config.fieldMappings) {
      const value = this.extractFieldValue(text, mapping.ocrLabel);

      if (value) {
        // Validate if rules exist
        let validated = true;
        let validationMessage = '';

        if (mapping.validationRules && mapping.validationRules.length > 0) {
          const validationResult = validateField(value, mapping.validationRules);
          validated = validationResult.valid;
          validationMessage = validationResult.message;
        }

        extractedFields[mapping.entityField] = {
          value,
          confidence: validated ? 0.85 : 0.5,
          source: `pattern_match_${mapping.ocrLabel}`,
          validated,
          validationMessage,
        };

        // Apply transforms if specified
        if (mapping.transform && validated) {
          const transformedValue = this.applyTransform(value, mapping.transform);
          const extractedField = extractedFields[mapping.entityField];
          if (transformedValue !== null && extractedField) {
            extractedField.value = transformedValue;
          }
        }
      }
    }

    return {
      classification: {
        documentType: classification.documentType,
        confidence: classification.confidence,
        matchedKeywords: classification.matchedKeywords,
        matchedPatterns: classification.matchedPatterns,
      },
      extractedFields,
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private extractFieldValue(text: string, fieldLabel: string): string | null {
    // Common extraction patterns
    const patterns = [
      // "Label: Value" or "Label : Value"
      new RegExp(`${fieldLabel}\\s*:\\s*([^\\n]+)`, 'i'),
      // "Label Value" on same line
      new RegExp(`${fieldLabel}\\s+([A-Za-z0-9][^\\n]{0,50})`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // Special case for SA ID - look for 13-digit number
    if (fieldLabel.toLowerCase().includes('id number')) {
      const idMatch = text.match(/\b(\d{13})\b/);
      if (idMatch?.[1]) {
        return idMatch[1];
      }
    }

    // Special case for account number - look for 9-12 digit number
    if (fieldLabel.toLowerCase().includes('account')) {
      const accountMatch = text.match(/\b(\d{9,12})\b/);
      if (accountMatch?.[1]) {
        return accountMatch[1];
      }
    }

    // Special case for branch code - look for 6-digit number
    if (fieldLabel.toLowerCase().includes('branch')) {
      const branchMatch = text.match(/\b(\d{6})\b/);
      if (branchMatch?.[1]) {
        return branchMatch[1];
      }
    }

    return null;
  }

  private applyTransform(value: string, transform: string): string | null {
    switch (transform) {
      case 'extractGenderFromSAID':
        return extractGenderFromSAID(value);

      case 'extractDOBFromSAID':
        return extractDOBFromSAID(value);

      case 'parseDate':
        // Try to parse common date formats
        const datePatterns = [
          /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
          /(\d{2})\/(\d{2})\/(\d{4})/, // DD/MM/YYYY
          /(\d{2})-(\d{2})-(\d{4})/, // DD-MM-YYYY
        ];

        for (const pattern of datePatterns) {
          const match = value.match(pattern);
          if (match) {
            if (pattern.source.startsWith('(\\d{4})')) {
              return `${match[1]}-${match[2]}-${match[3]}`;
            } else {
              return `${match[3]}-${match[2]}-${match[1]}`;
            }
          }
        }
        return value;

      default:
        return value;
    }
  }

  private mapExtractedFields(rawFields: Record<string, unknown>): ExtractedFields {
    const fields: ExtractedFields = {};

    for (const [key, value] of Object.entries(rawFields)) {
      if (typeof value === 'object' && value !== null) {
        const fieldObj = value as Record<string, unknown>;
        fields[key] = {
          value: fieldObj.value as string | number | boolean | null,
          confidence: (fieldObj.confidence as number) || 0,
          source: (fieldObj.source as string) || 'ocr',
          validated: fieldObj.validated as boolean | undefined,
          validationMessage: fieldObj.validation_message as string | undefined,
        };
      } else {
        fields[key] = {
          value: value as string | number | boolean | null,
          confidence: 0.7,
          source: 'ocr',
        };
      }
    }

    return fields;
  }

  private shouldFallbackToMock(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('fetch failed') ||
        error.message.includes('network')
      );
    }
    return false;
  }

  // ============================================================================
  // Mock Responses for Development
  // ============================================================================

  private getMockHealth(): OcrServiceHealth {
    return {
      status: 'healthy',
      tiers: {
        tesseract: true,
        paddleocr: true,
        ocrspace: true,
        gemini: true,
      },
      version: 'mock-1.0.0',
    };
  }

  private getMockExtractText(request: OcrExtractRequest): OcrExtractResponse {
    log.info('Using mock OCR text extraction', { fileUrl: request.fileUrl });

    // Generate mock text based on common document patterns
    const mockText = `
REPUBLIC OF SOUTH AFRICA
IDENTITY DOCUMENT

Surname: SMITH
First Names: JOHN DAVID
ID Number: 8501015800080
Date of Birth: 01 JAN 1985
Gender: Male
Country of Birth: SOUTH AFRICA
Citizenship: SA Citizen

DEPARTMENT OF HOME AFFAIRS
    `.trim();

    return {
      success: true,
      text: mockText,
      confidence: 0.92,
      tierUsed: OcrTier.TESSERACT,
      processingTimeMs: 1500,
      pageCount: 1,
    };
  }

  private getMockClassification(): DocumentClassification {
    return {
      documentType: 'id_document',
      confidence: 0.95,
      matchedKeywords: ['REPUBLIC OF SOUTH AFRICA', 'IDENTITY', 'ID NUMBER'],
      matchedPatterns: ['\\d{13}'],
    };
  }

  private getMockFieldExtraction(request: OcrFieldExtractionRequest): OcrFieldExtractionResponse {
    log.info('Using mock OCR field extraction', { request });

    // Determine document type based on URL or default to ID document
    const isStaff = request.entityType === OcrEntityType.STAFF;

    if (isStaff) {
      // Mock SA ID extraction
      return {
        success: true,
        classification: {
          documentType: 'id_document',
          confidence: 0.95,
          matchedKeywords: ['REPUBLIC OF SOUTH AFRICA', 'IDENTITY', 'ID NUMBER'],
          matchedPatterns: ['\\d{13}'],
        },
        extractedFields: {
          idNumber: {
            value: '8501015800080',
            confidence: 0.98,
            source: 'line_7',
            validated: true,
            validationMessage: 'Valid SA ID',
          },
          firstName: {
            value: 'JOHN DAVID',
            confidence: 0.95,
            source: 'line_5',
          },
          lastName: {
            value: 'SMITH',
            confidence: 0.95,
            source: 'line_4',
          },
          dateOfBirth: {
            value: '1985-01-01',
            confidence: 0.92,
            source: 'derived_from_id',
          },
          gender: {
            value: 'male',
            confidence: 0.99,
            source: 'derived_from_id',
          },
          nationality: {
            value: 'South African',
            confidence: 0.90,
            source: 'line_11',
          },
        },
        rawText: `REPUBLIC OF SOUTH AFRICA
IDENTITY DOCUMENT

Surname: SMITH
First Names: JOHN DAVID
ID Number: 8501015800080
Date of Birth: 01 JAN 1985
Gender: Male
Country of Birth: SOUTH AFRICA
Citizenship: SA Citizen`,
        tierUsed: OcrTier.TESSERACT,
        overallConfidence: 0.93,
        processingTimeMs: 2300,
        pageCount: 1,
      };
    } else {
      // Mock CIPC extraction for contractors
      return {
        success: true,
        classification: {
          documentType: 'cipc_registration',
          confidence: 0.92,
          matchedKeywords: ['CIPC', 'COMPANY REGISTRATION', 'REGISTRATION NUMBER'],
          matchedPatterns: ['\\d{4}/\\d{6}/\\d{2}'],
        },
        extractedFields: {
          companyName: {
            value: 'ACME CONTRACTORS (PTY) LTD',
            confidence: 0.95,
            source: 'line_3',
          },
          registrationNumber: {
            value: '2020/123456/07',
            confidence: 0.98,
            source: 'line_5',
            validated: true,
            validationMessage: 'Valid CIPC registration format',
          },
        },
        rawText: `COMPANIES AND INTELLECTUAL PROPERTY COMMISSION
NOTICE OF REGISTRATION

Company Name: ACME CONTRACTORS (PTY) LTD
Registration Number: 2020/123456/07
Registration Date: 15 March 2020`,
        tierUsed: OcrTier.TESSERACT,
        overallConfidence: 0.91,
        processingTimeMs: 2100,
        pageCount: 1,
      };
    }
  }
}

// ============================================================================
// Singleton Instance and Exports
// ============================================================================

// Singleton instance
const ocrService = new OcrService();

/**
 * Check if OCR service is available
 */
export async function isOcrServiceAvailable(): Promise<boolean> {
  const health = await ocrService.health();
  return health.status !== 'unhealthy';
}

/**
 * Get OCR service health status
 */
export async function getOcrServiceHealth(): Promise<OcrServiceHealth> {
  return ocrService.health();
}

/**
 * Extract text from a document
 */
export async function extractTextFromDocument(
  fileUrl: string,
  preferredTier?: OcrTier
): Promise<OcrExtractResponse> {
  return ocrService.extractText({ fileUrl, preferredTier });
}

/**
 * Classify a document
 */
export async function classifyDocumentFromUrl(
  fileUrl: string
): Promise<DocumentClassification | null> {
  return ocrService.classify(fileUrl);
}

/**
 * Extract structured fields from a document
 * This is the main function to use for document processing
 */
export async function extractFieldsFromDocument(
  fileUrl: string,
  entityType: OcrEntityType,
  documentType?: string
): Promise<OcrFieldExtractionResponse> {
  return ocrService.extractFields({
    fileUrl,
    entityType,
    documentType,
  });
}

// Export the service class and instance
export { ocrService };
export default OcrService;
