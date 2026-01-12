/**
 * useOcrExtraction Hook
 * Manages OCR extraction state: trigger processing, poll for results, confirm fields
 *
 * PRD Reference: PRD-032 OCR Document Extraction System
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  type OcrResult,
  type OcrProcessResponse,
  type OcrResultsResponse,
  type OcrConfirmResponse,
  type FieldsToApply,
  OcrDocumentTable,
  OcrEntityType,
  OcrStatus,
} from '@/types/ocr.types';

interface UseOcrExtractionOptions {
  /** Auto-poll interval in ms (default: 2000) */
  pollInterval?: number;
  /** Max polling attempts before giving up (default: 30) */
  maxPollAttempts?: number;
}

interface UseOcrExtractionResult {
  /** Current OCR result */
  result: OcrResult | null;
  /** Current entity data for comparison */
  currentEntityData: Record<string, unknown>;
  /** Whether processing is in progress */
  isProcessing: boolean;
  /** Whether we're polling for results */
  isPolling: boolean;
  /** Whether we're confirming fields */
  isConfirming: boolean;
  /** Error message if any */
  error: string | null;
  /** Process a document for OCR extraction */
  processDocument: (
    documentId: string,
    documentTable: OcrDocumentTable,
    entityType: OcrEntityType,
    entityId: string,
    forceReprocess?: boolean
  ) => Promise<void>;
  /** Get OCR results for a document */
  getResults: (documentId: string, documentTable?: OcrDocumentTable) => Promise<void>;
  /** Confirm and apply selected fields */
  confirmFields: (ocrResultId: string, fieldsToApply: FieldsToApply) => Promise<OcrConfirmResponse | null>;
  /** Clear current result */
  clearResult: () => void;
  /** Clear error */
  clearError: () => void;
}

export function useOcrExtraction(options: UseOcrExtractionOptions = {}): UseOcrExtractionResult {
  const { pollInterval = 2000, maxPollAttempts = 30 } = options;

  const [result, setResult] = useState<OcrResult | null>(null);
  const [currentEntityData, setCurrentEntityData] = useState<Record<string, unknown>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollCountRef = useRef(0);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Fetch OCR results for a document
   */
  const getResults = useCallback(
    async (documentId: string, documentTable: OcrDocumentTable = OcrDocumentTable.STAFF_DOCUMENTS) => {
      try {
        const params = new URLSearchParams({
          documentId,
          documentTable,
        });

        const response = await fetch(`/api/documents-ocr-results?${params}`);
        const data: OcrResultsResponse = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch OCR results');
        }

        setResult(data.result);
        setCurrentEntityData(data.currentEntityData || {});
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error fetching results';
        setError(message);
      }
    },
    []
  );

  /**
   * Poll for OCR results until completed or max attempts reached
   */
  const pollForResults = useCallback(
    (documentId: string, documentTable: OcrDocumentTable) => {
      pollCountRef.current = 0;
      setIsPolling(true);

      const poll = async () => {
        pollCountRef.current += 1;

        try {
          await getResults(documentId, documentTable);

          // Check if we should continue polling
          if (result && result.status !== OcrStatus.PENDING) {
            setIsPolling(false);
            return;
          }

          if (pollCountRef.current >= maxPollAttempts) {
            setIsPolling(false);
            setError('OCR processing timed out');
            return;
          }

          // Continue polling
          pollTimeoutRef.current = setTimeout(poll, pollInterval);
        } catch {
          setIsPolling(false);
        }
      };

      poll();
    },
    [getResults, maxPollAttempts, pollInterval, result]
  );

  /**
   * Process a document for OCR extraction
   */
  const processDocument = useCallback(
    async (
      documentId: string,
      documentTable: OcrDocumentTable,
      entityType: OcrEntityType,
      entityId: string,
      forceReprocess = false
    ) => {
      setIsProcessing(true);
      setError(null);

      try {
        const response = await fetch('/api/documents-process-ocr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            documentId,
            documentTable,
            entityType,
            entityId,
            forceReprocess,
          }),
        });

        const data: OcrProcessResponse = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to process document');
        }

        // If completed immediately, fetch the results
        if (data.status === 'completed') {
          await getResults(documentId, documentTable);
        } else if (data.status === 'processing') {
          // Start polling for results
          pollForResults(documentId, documentTable);
        } else if (data.status === 'failed') {
          setError('OCR processing failed');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error processing document';
        setError(message);
      } finally {
        setIsProcessing(false);
      }
    },
    [getResults, pollForResults]
  );

  /**
   * Confirm and apply selected fields
   */
  const confirmFields = useCallback(
    async (ocrResultId: string, fieldsToApply: FieldsToApply): Promise<OcrConfirmResponse | null> => {
      setIsConfirming(true);
      setError(null);

      try {
        const response = await fetch('/api/documents-ocr-confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ocrResultId,
            fieldsToApply,
          }),
        });

        const data: OcrConfirmResponse = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to confirm OCR results');
        }

        // Update result status
        if (result) {
          setResult({
            ...result,
            status: OcrStatus.CONFIRMED,
            appliedFields: fieldsToApply as unknown as typeof result.appliedFields,
          });
        }

        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error confirming fields';
        setError(message);
        return null;
      } finally {
        setIsConfirming(false);
      }
    },
    [result]
  );

  /**
   * Clear current result
   */
  const clearResult = useCallback(() => {
    setResult(null);
    setCurrentEntityData({});
    setError(null);
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
    }
    setIsPolling(false);
  }, []);

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    result,
    currentEntityData,
    isProcessing,
    isPolling,
    isConfirming,
    error,
    processDocument,
    getResults,
    confirmFields,
    clearResult,
    clearError,
  };
}

export default useOcrExtraction;
