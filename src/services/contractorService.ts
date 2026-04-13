/**
 * Contractor Service
 * Top-level service for CRUD operations on contractor records.
 * Delegates to the API routes — no direct DB access from client bundles.
 */

import type { Contractor } from '@/types/contractor.core.types';

// ==================== IMPLEMENTATION ====================

/**
 * Fetches all contractor records from the API.
 */
async function getAll(): Promise<Contractor[]> {
  const response = await fetch('/api/contractors');

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to fetch contractors (status ${response.status})`);
  }

  return response.json() as Promise<Contractor[]>;
}

// ==================== EXPORT ====================

export const contractorService = {
  getAll,
};
