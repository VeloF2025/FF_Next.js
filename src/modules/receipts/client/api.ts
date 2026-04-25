/**
 * Typed fetch wrappers for the /api/my/receipts endpoints.
 *
 * Mirrors the pattern in src/modules/attendance/portal/client/api.ts —
 * same envelope shape, same ApiError. Reuses the request<T> helper from
 * the attendance portal client so we don't duplicate the cookie + JSON
 * envelope plumbing.
 */

import type { ReceiptCategory } from '../categories';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const text = await res.text();
  let env: ApiEnvelope<T> | null = null;
  try {
    env = text ? (JSON.parse(text) as ApiEnvelope<T>) : null;
  } catch {
    throw new ApiError(res.status, 'PARSE_ERROR', `Server returned non-JSON (HTTP ${res.status})`);
  }
  if (!env || !res.ok || !env.success) {
    const e = env?.error ?? { code: 'UNKNOWN', message: `HTTP ${res.status}` };
    throw new ApiError(res.status, e.code, e.message);
  }
  return env.data as T;
}

async function fetchMultipart<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    body,
  });
  const text = await res.text();
  let env: ApiEnvelope<T> | null = null;
  try {
    env = text ? (JSON.parse(text) as ApiEnvelope<T>) : null;
  } catch {
    throw new ApiError(res.status, 'PARSE_ERROR', `Server returned non-JSON (HTTP ${res.status})`);
  }
  if (!env || !res.ok || !env.success) {
    const e = env?.error ?? { code: 'UNKNOWN', message: `HTTP ${res.status}` };
    throw new ApiError(res.status, e.code, e.message);
  }
  return env.data as T;
}

// =============================================================================
// /api/my/receipts/extract
// =============================================================================

export interface ExtractResponse {
  extractionId: string;
  imageUrl: string;
  imageMime: string;
  vlmSuccess: boolean;
  vendor: string | null;
  totalCents: number | null;
  vatCents: number | null;
  date: string | null;
  categoryGuess: ReceiptCategory;
  lineItems: { description: string; amountCents: number | null }[];
  confidence: number;
}

export function extractReceipt(photo: File | Blob): Promise<ExtractResponse> {
  const fd = new FormData();
  fd.append('photo', photo, photo instanceof File ? photo.name : 'receipt.jpg');
  return fetchMultipart<ExtractResponse>('/api/my/receipts/extract', fd);
}

// =============================================================================
// /api/my/receipts/save
// =============================================================================

export type PaymentMethod = 'company_card' | 'personal_reimbursement';

export interface SaveReceiptArgs {
  extractionId: string;
  imageUrl: string;
  imageMime: string;
  receiptDate: string;
  vendor: string | null;
  totalCents: number;
  vatCents: number | null;
  category: ReceiptCategory;
  description: string | null;
  paymentMethod: PaymentMethod;
  projectId: string | null;
  capturedLat: number | null;
  capturedLon: number | null;
  ocrRaw: Record<string, unknown> | null;
  ocrCategoryGuess: string | null;
  ocrConfidence: number | null;
}

export interface SaveResponse {
  id: string;
  receiptDate: string;
  vendor: string | null;
  totalCents: number;
  category: ReceiptCategory;
  paymentMethod: PaymentMethod;
}

export function saveReceipt(args: SaveReceiptArgs): Promise<SaveResponse> {
  return fetchJson<SaveResponse>('/api/my/receipts/save', {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

// =============================================================================
// /api/my/receipts (list)
// =============================================================================

export interface ReceiptListItem {
  id: string;
  receiptDate: string;
  vendor: string | null;
  totalCents: number;
  vatCents: number | null;
  currency: string;
  category: ReceiptCategory;
  paymentMethod: PaymentMethod;
  projectId: string | null;
  status: 'submitted' | 'approved' | 'rejected' | 'reconciled';
  hasImage: boolean;
  capturedAt: string;
}

export function listMyReceipts(): Promise<{ items: ReceiptListItem[] }> {
  return fetchJson<{ items: ReceiptListItem[] }>('/api/my/receipts', { method: 'GET' });
}

export function receiptDownloadUrl(receiptId: string): string {
  return `/api/my/receipts/${encodeURIComponent(receiptId)}/download`;
}

// =============================================================================
// /api/my/receipts/[id]/edit
// =============================================================================

export interface EditReceiptArgs {
  receiptDate?: string;
  vendor?: string | null;
  totalCents?: number;
  vatCents?: number | null;
  category?: ReceiptCategory;
  description?: string | null;
  paymentMethod?: PaymentMethod;
  projectId?: string | null;
}

export function editMyReceipt(receiptId: string, args: EditReceiptArgs): Promise<SaveResponse> {
  return fetchJson<SaveResponse>(`/api/my/receipts/${encodeURIComponent(receiptId)}/edit`, {
    method: 'PATCH',
    body: JSON.stringify(args),
  });
}

export { ApiError };
