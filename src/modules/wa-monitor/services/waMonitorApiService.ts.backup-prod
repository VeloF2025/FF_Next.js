/**
 * WA Monitor Frontend API Service
 * Client-side API calls for QA review drops
 * Handles API communication and error handling
 */

import type { QaReviewDrop, WaMonitorApiResponse, WaMonitorSummary, DailyDropsPerProject } from '../types/wa-monitor.types';

// ==================== API ENDPOINTS ====================

const API_BASE = '/api/wa-monitor-drops';
const API_DAILY_DROPS = '/api/wa-monitor-daily-drops';

// ==================== API CALLS ====================

/**
 * Fetch all QA review drops
 * Returns drops with summary statistics
 */
export async function fetchAllDrops(): Promise<{
  drops: QaReviewDrop[];
  summary?: WaMonitorSummary;
}> {
  try {
    const response = await fetch(API_BASE, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }

    const data: WaMonitorApiResponse = await response.json();

    // Handle standard API response format
    const drops = data.data || [];
    const summary = data.summary;

    return { drops, summary };
  } catch (error) {
    console.error('Error fetching drops:', error);
    throw error instanceof Error ? error : new Error('Failed to fetch QA review drops');
  }
}

/**
 * Fetch a single drop by ID
 */
export async function fetchDropById(id: string): Promise<QaReviewDrop> {
  try {
    const response = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.data || data;
  } catch (error) {
    console.error(`Error fetching drop ${id}:`, error);
    throw error instanceof Error ? error : new Error('Failed to fetch drop');
  }
}

/**
 * Fetch drops by status
 */
export async function fetchDropsByStatus(status: 'incomplete' | 'complete'): Promise<QaReviewDrop[]> {
  try {
    const response = await fetch(`${API_BASE}?status=${status}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error(`Error fetching drops with status ${status}:`, error);
    throw error instanceof Error ? error : new Error('Failed to fetch drops by status');
  }
}

/**
 * Fetch daily drops per project for today
 * Returns count of drops submitted today grouped by project
 */
export async function fetchDailyDropsPerProject(): Promise<{
  drops: DailyDropsPerProject[];
  total: number;
  date: string;
}> {
  try {
    const response = await fetch(API_DAILY_DROPS, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    return result.data || { drops: [], total: 0, date: new Date().toISOString().split('T')[0] };
  } catch (error) {
    console.error('Error fetching daily drops:', error);
    throw error instanceof Error ? error : new Error('Failed to fetch daily drops per project');
  }
}

/**
 * Send QA feedback to WhatsApp group
 * @param dropId - Database ID of the drop
 * @param dropNumber - Drop number (e.g., DR1857010)
 * @param message - Feedback message to send
 * @param project - Project name (defaults to Velo Test for testing)
 */
export async function sendFeedbackToWhatsApp(
  dropId: string,
  dropNumber: string,
  message: string,
  project?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch('/api/wa-monitor-send-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dropId,
        dropNumber,
        message,
        project: project || 'Velo Test', // Default to Velo Test for testing
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      success: data.success,
      message: data.message || 'Feedback sent successfully'
    };
  } catch (error) {
    console.error('Error sending feedback:', error);
    throw error instanceof Error ? error : new Error('Failed to send feedback');
  }
}

/**
 * Lock a drop for editing
 * Prevents other users from editing the same drop concurrently
 * @param dropId - Database ID of the drop
 * @param userName - Name of user requesting the lock
 */
export async function lockDrop(
  dropId: string,
  userName: string
): Promise<{ locked: boolean; lockedBy: string; lockedAt: string; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/${dropId}/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userName }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Handle conflict (locked by another user)
      if (response.status === 409) {
        return {
          locked: false,
          lockedBy: data.error?.lockedBy || 'Unknown user',
          lockedAt: data.error?.lockedAt || new Date().toISOString(),
          error: data.error?.message || 'Drop is locked by another user',
        };
      }

      throw new Error(data.error?.message || 'Failed to lock drop');
    }

    return data.data;
  } catch (error) {
    console.error('Error locking drop:', error);
    throw error instanceof Error ? error : new Error('Failed to lock drop');
  }
}

/**
 * Unlock a drop after editing
 * Allows other users to edit the drop
 * @param dropId - Database ID of the drop
 * @param userName - Name of user releasing the lock
 */
export async function unlockDrop(
  dropId: string,
  userName: string
): Promise<{ unlocked: boolean }> {
  try {
    const response = await fetch(`${API_BASE}/${dropId}/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userName }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.error?.message || error.message || 'Failed to unlock drop');
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error unlocking drop:', error);
    throw error instanceof Error ? error : new Error('Failed to unlock drop');
  }
}

/**
 * Update a drop's QA review data
 * @param dropId - Database ID of the drop
 * @param updates - Partial drop data to update
 */
export async function updateDrop(
  dropId: string,
  updates: Partial<QaReviewDrop>
): Promise<QaReviewDrop> {
  try {
    const response = await fetch(`${API_BASE}/${dropId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.error?.message || error.message || 'Failed to update drop');
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error updating drop:', error);
    throw error instanceof Error ? error : new Error('Failed to update drop');
  }
}

// ==================== HELPERS ====================

/**
 * Handle standard API response format
 * Unwraps { success: true, data: {...} } responses
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.data || data;
}

/**
 * Build query string from parameters
 */
export function buildQueryString(params: Record<string, any>): string {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.append(key, String(value));
    }
  });

  return query.toString();
}
