/**
 * useStep1Draft — persists Step 1 form fields to localStorage.
 * Saves on every change (debounced), restores on mount, clears on submit.
 */

import { useCallback, useRef, useState } from 'react';
import { log } from '@/lib/logger';
import type { FormItem } from './RequisitionItemsTable';

const DRAFT_KEY = 'procurement_step1_draft';
const DEBOUNCE_MS = 600;

export interface Step1DraftData {
  projectId: string;
  costCenterId?: string;
  department: string;
  requiredDate: string;
  urgency: string;
  notes: string;
  items: FormItem[];
  savedAt: number;
}

export function loadStep1Draft(): Step1DraftData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Step1DraftData;
  } catch (err) {
    log.warn('Failed to parse Step 1 draft', { err }, 'useStep1Draft');
    return null;
  }
}

export function useStep1Draft() {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  /** Debounced save — writes after DEBOUNCE_MS ms of inactivity. */
  const saveDraft = useCallback((data: Omit<Step1DraftData, 'savedAt'>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ ...data, savedAt: Date.now() }),
        );
        setLastSaved(new Date());
      } catch (err) {
        log.warn('Failed to save Step 1 draft', { err }, 'useStep1Draft');
      }
    }, DEBOUNCE_MS);
  }, []);

  /** Remove the draft (call after successful submission). */
  const clearDraft = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(DRAFT_KEY);
    }
    setLastSaved(null);
  }, []);

  return { saveDraft, clearDraft, lastSaved };
}
