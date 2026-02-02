/**
 * PO Extraction Types
 * Types for VLM-based Client PO PDF extraction
 */

/**
 * Result of VLM extraction from a Client PO PDF
 */
export interface POExtractionResult {
  poNumber: string | null;
  reference: string | null;
  poDate: string | null;       // ISO date string YYYY-MM-DD
  quantity: number | null;      // Contracted drops
  unitPrice: number | null;     // Price per drop
  vatRate: number | null;       // VAT percentage (e.g., 15)
  subtotal: number | null;
  vatAmount: number | null;
  total: number | null;
  description: string | null;
  confidence: number;           // 0-1 overall confidence
}

/**
 * API response from extract-from-pdf endpoint
 */
export interface POExtractionAPIResponse {
  success: boolean;
  extraction: POExtractionResult | null;
  documentUrl: string | null;   // URL to uploaded PDF in VF Storage
  documentName: string | null;  // Original filename
  error?: string;
  processingTimeMs: number;
}

/**
 * Project document types
 */
export type ProjectDocumentType =
  | 'bss'       // Build Service Schedule
  | 'mss'       // Maintenance Service Schedule
  | 'contract'  // Main contract
  | 'amendment' // Contract amendment
  | 'wayleave'  // Wayleave agreement
  | 'permit'    // Permit document
  | 'other';    // Other documents

/**
 * Project document record
 */
export interface ProjectDocument {
  id: string;
  projectId: string;
  documentType: ProjectDocumentType;
  documentName: string;
  fileUrl: string;
  filePath?: string;
  fileSize?: number;
  mimeType?: string;
  description?: string;
  version?: string;
  effectiveDate?: string;
  expiryDate?: string;
  clientPoId?: string;       // Optional link to Client PO
  uploadedBy: string;
  uploadedAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating a project document
 */
export interface ProjectDocumentCreateInput {
  documentType: ProjectDocumentType;
  documentName: string;
  fileUrl: string;
  filePath?: string;
  fileSize?: number;
  mimeType?: string;
  description?: string;
  version?: string;
  effectiveDate?: string;
  expiryDate?: string;
  clientPoId?: string;
}

/**
 * Document type display info
 */
export const DOCUMENT_TYPE_LABELS: Record<ProjectDocumentType, string> = {
  bss: 'Build Service Schedule',
  mss: 'Maintenance Service Schedule',
  contract: 'Contract',
  amendment: 'Amendment',
  wayleave: 'Wayleave Agreement',
  permit: 'Permit',
  other: 'Other Document',
};

/**
 * Confidence level thresholds for UI display
 */
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.85,    // Green - high confidence
  MEDIUM: 0.60,  // Yellow - review suggested
  LOW: 0,        // Red - manual verification needed
} as const;

/**
 * Get confidence level for display
 */
export function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) return 'high';
  if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Get confidence color class
 */
export function getConfidenceColorClass(confidence: number): string {
  const level = getConfidenceLevel(confidence);
  switch (level) {
    case 'high': return 'text-green-400 border-green-500/30 bg-green-500/10';
    case 'medium': return 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';
    case 'low': return 'text-red-400 border-red-500/30 bg-red-500/10';
  }
}
