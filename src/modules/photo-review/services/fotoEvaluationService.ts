/**
 * Foto Review Frontend API Service
 * Client-side API calls for DR photo evaluation
 * Handles API communication and error handling
 */

import type {
  DropRecord,
  EvaluationResult,
  EvaluateRequest,
  SendFeedbackRequest,
  FeedbackResponse,
  PhotoFilters,
} from '../types';

// ==================== API ENDPOINTS ====================

const API_BASE = '/api/foto';
const API_PHOTOS = `${API_BASE}/photos`;
const API_EVALUATE = `${API_BASE}/evaluate`;
const API_FEEDBACK = `${API_BASE}/feedback`;

// ==================== HELPER FUNCTIONS ====================

/**
 * Build query string from filters
 */
function buildQueryString(filters?: PhotoFilters): string {
  if (!filters) return '';

  const params = new URLSearchParams();

  if (filters.project) {
    params.append('project', filters.project);
  }

  if (filters.startDate) {
    params.append('startDate', filters.startDate.toISOString());
  }

  if (filters.endDate) {
    params.append('endDate', filters.endDate.toISOString());
  }

  if (filters.evaluationStatus) {
    params.append('status', filters.evaluationStatus);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Handle API response and error extraction
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  // Unwrap { success: true, data: {...} } format
  return data.data || data;
}

// ==================== API CALLS ====================

/**
 * Fetch all DRs with photos
 * Supports filtering by project, date range, and evaluation status
 */
export async function fetchPhotos(filters?: PhotoFilters): Promise<DropRecord[]> {
  try {
    const queryString = buildQueryString(filters);
    const response = await fetch(`${API_PHOTOS}${queryString}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse<DropRecord[]>(response);
  } catch (error) {
    console.error('Error fetching photos:', error);
    throw error instanceof Error ? error : new Error('Failed to fetch photos');
  }
}

/**
 * Fetch photos for a specific DR
 */
export async function fetchPhotosByDR(dr_number: string): Promise<DropRecord> {
  try {
    const response = await fetch(`${API_PHOTOS}?dr_number=${encodeURIComponent(dr_number)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return await handleResponse<DropRecord>(response);
  } catch (error) {
    console.error(`Error fetching photos for DR ${dr_number}:`, error);
    throw error instanceof Error ? error : new Error('Failed to fetch DR photos');
  }
}

/**
 * Trigger AI evaluation for a DR
 * This calls the Python backend script via Next.js API
 */
export async function evaluateDR(dr_number: string): Promise<EvaluationResult> {
  try {
    const request: EvaluateRequest = { dr_number };

    const response = await fetch(API_EVALUATE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    return await handleResponse<EvaluationResult>(response);
  } catch (error) {
    console.error(`Error evaluating DR ${dr_number}:`, error);
    throw error instanceof Error ? error : new Error('Failed to evaluate DR');
  }
}

/**
 * Fetch existing evaluation results for a DR
 * Returns cached evaluation from database
 */
export async function getEvaluation(dr_number: string): Promise<EvaluationResult | null> {
  try {
    const response = await fetch(`${API_BASE}/evaluation/${encodeURIComponent(dr_number)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      return null; // No evaluation found
    }

    return await handleResponse<EvaluationResult>(response);
  } catch (error) {
    console.error(`Error fetching evaluation for DR ${dr_number}:`, error);
    throw error instanceof Error ? error : new Error('Failed to fetch evaluation');
  }
}

/**
 * Send WhatsApp feedback for an evaluation
 * Supports both auto-generated and custom messages
 * @param dr_number - The DR number to send feedback for
 * @param message - Optional custom message (if not provided, uses evaluation from DB)
 * @param project - Optional project name for routing to correct WhatsApp group
 */
export async function sendFeedback(
  dr_number: string,
  message?: string,
  project?: string
): Promise<FeedbackResponse> {
  try {
    const request: SendFeedbackRequest = {
      dr_number,
      ...(message && { message }),
      ...(project && { project })
    };

    const response = await fetch(API_FEEDBACK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    return await handleResponse<FeedbackResponse>(response);
  } catch (error) {
    console.error(`Error sending feedback for DR ${dr_number}:`, error);
    throw error instanceof Error ? error : new Error('Failed to send feedback');
  }
}

/**
 * Re-evaluate a DR (overwrites previous evaluation)
 */
export async function reEvaluateDR(dr_number: string): Promise<EvaluationResult> {
  try {
    // Same as evaluateDR - backend will UPDATE existing record
    return await evaluateDR(dr_number);
  } catch (error) {
    console.error(`Error re-evaluating DR ${dr_number}:`, error);
    throw error instanceof Error ? error : new Error('Failed to re-evaluate DR');
  }
}

/**
 * Check if a DR has been evaluated
 */
export async function isEvaluated(dr_number: string): Promise<boolean> {
  try {
    const evaluation = await getEvaluation(dr_number);
    return evaluation !== null;
  } catch (error) {
    console.error(`Error checking evaluation status for DR ${dr_number}:`, error);
    return false;
  }
}

// ==================== EXPORT ALL ====================

export const fotoEvaluationApi = {
  fetchPhotos,
  fetchPhotosByDR,
  evaluateDR,
  getEvaluation,
  sendFeedback,
  reEvaluateDR,
  isEvaluated,
};
