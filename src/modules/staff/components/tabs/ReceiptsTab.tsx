'use client';

/**
 * Receipts tab for the StaffDetail page.
 *
 * Lists this staff member's submitted receipts (latest first), reusing
 * the existing /api/staff/receipts review endpoint with a staffId
 * filter. The endpoint is RBAC-gated by `receipts.review:view`, so the
 * tab itself only renders for users with that permission.
 *
 * Theme: matches sibling tabs (--ff-bg-* / --ff-text-* / --ff-border-*).
 *
 * Out of scope here (handled by /staff/receipts review queue):
 *   - Approve / reject / reconcile actions
 *   - Multi-staff filtering
 *   - CSV export
 * The "Open in review queue" link at the bottom deep-links there with
 * the staffId pre-applied.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Receipt, AlertCircle, ExternalLink, Eye } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type ReceiptStatus = 'submitted' | 'approved' | 'rejected' | 'reconciled';

interface ReceiptRow {
  id: string;
  receipt_date: string;
  vendor: string | null;
  total_cents: string;
  vat_cents: string | null;
  currency: string;
  category: string;
  description: string | null;
  payment_method: 'company_card' | 'personal_reimbursement';
  project_name: string | null;
  vehicle_registration: string | null;
  status: ReceiptStatus;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  captured_at: string;
}

interface ApiBody {
  success: true;
  data: { items: ReceiptRow[] };
}

type ApiFailure = { success: false; error?: { message?: string } };

function extractErrorMessage(body: unknown, fallback: string): string {
  const err = (body as ApiFailure | undefined)?.error;
  return (typeof err?.message === 'string' && err.message) || fallback;
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel: 'Fuel',
  tools: 'Tools',
  equipment: 'Equipment',
  materials: 'Materials',
  food: 'Food',
  accommodation: 'Accommodation',
  parking: 'Parking',
  tolls: 'Tolls',
  office_supplies: 'Office supplies',
  courier: 'Courier',
  other: 'Other',
};

export function ReceiptsTab({ staffId }: { staffId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<ReceiptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // No status filter — show every status the reviewer can see for
        // this staff. Server clamps limit; 200 is plenty for a profile.
        const res = await fetch(
          `/api/staff/receipts?staffId=${encodeURIComponent(staffId)}&limit=100`,
          { credentials: 'include' }
        );
        const body = (await res.json().catch(() => null)) as ApiBody | ApiFailure | null;
        if (cancelled) return;
        if (!res.ok || !body || body.success !== true) {
          if (res.status === 403) {
            setError('You do not have permission to view receipts for this staff member.');
          } else {
            setError(extractErrorMessage(body, 'Could not load receipts.'));
          }
          return;
        }
        setItems(body.data.items);
      } catch {
        if (!cancelled) setError('Network error loading receipts.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [staffId]);

  if (error) {
    return (
      <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!items) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <div className="text-center py-10">
          <div className="mx-auto w-12 h-12 rounded-full bg-[var(--ff-bg-tertiary)] flex items-center justify-center mb-3">
            <Receipt className="w-6 h-6 text-[var(--ff-text-muted)]" />
          </div>
          <div className="text-sm font-medium text-[var(--ff-text-primary)]">No receipts submitted</div>
          <div className="mt-1 text-xs text-[var(--ff-text-secondary)]">
            This staff member hasn&rsquo;t captured any receipts yet.
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[var(--ff-bg-tertiary)]">
                  <tr>
                    <Th>Date</Th>
                    <Th>Vendor</Th>
                    <Th>Category</Th>
                    <Th>Project / Vehicle</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Status</Th>
                    <Th>Image</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ff-border-light)]">
                  {items.map((r) => (
                    <ReceiptRowView key={r.id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.push(`/staff/receipts?staffId=${encodeURIComponent(staffId)}`)}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            <ExternalLink className="w-3 h-3" />
            Open in review queue (approve / reject / reconcile)
          </button>
        </>
      )}
    </div>
  );
}

function ReceiptRowView({ row }: { row: ReceiptRow }) {
  const total = Number(row.total_cents);
  return (
    <tr className="hover:bg-[var(--ff-bg-hover)]">
      <Td className="whitespace-nowrap">{formatDate(row.receipt_date)}</Td>
      <Td>
        <div className="font-medium text-[var(--ff-text-primary)] truncate max-w-xs" title={row.vendor ?? ''}>
          {row.vendor ?? <span className="text-[var(--ff-text-muted)]">No vendor</span>}
        </div>
        {row.description && (
          <div className="text-xs text-[var(--ff-text-secondary)] truncate max-w-xs" title={row.description}>
            {row.description}
          </div>
        )}
      </Td>
      <Td className="whitespace-nowrap">
        <span className="text-xs uppercase tracking-wide text-[var(--ff-text-secondary)]">
          {CATEGORY_LABELS[row.category] ?? row.category}
        </span>
        {row.payment_method === 'company_card' && (
          <div className="text-[10px] text-[var(--ff-text-muted)] mt-0.5">Company card</div>
        )}
      </Td>
      <Td className="text-xs">
        {row.project_name ? (
          <div className="text-[var(--ff-text-primary)]">{row.project_name}</div>
        ) : (
          <div className="text-[var(--ff-text-muted)]">—</div>
        )}
        {row.vehicle_registration && (
          <div className="mt-0.5 text-[var(--ff-text-secondary)]">{row.vehicle_registration}</div>
        )}
      </Td>
      <Td className="text-right tabular-nums whitespace-nowrap font-semibold">
        {formatRand(total)}
        {row.vat_cents !== null && (
          <div className="text-xs text-[var(--ff-text-muted)] font-normal">
            VAT {formatRand(Number(row.vat_cents))}
          </div>
        )}
      </Td>
      <Td className="whitespace-nowrap">
        <StatusPill status={row.status} />
        {row.review_note && (
          <div
            className="text-[10px] text-[var(--ff-text-secondary)] mt-0.5 max-w-[12rem] truncate"
            title={row.review_note}
          >
            “{row.review_note}”
          </div>
        )}
      </Td>
      <Td>
        <a
          href={`/api/staff/receipts-image?id=${encodeURIComponent(row.id)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/15 text-blue-300 text-xs hover:bg-blue-500/25 border border-blue-500/30"
          title="Open the captured receipt image"
        >
          <Eye className="w-3 h-3" />
          View
        </a>
      </Td>
    </tr>
  );
}

function StatusPill({ status }: { status: ReceiptStatus }) {
  const cls: Record<ReceiptStatus, string> = {
    submitted: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    rejected: 'bg-red-500/15 text-red-300 border-red-500/30',
    reconciled: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border rounded-full ${cls[status]}`}>
      {status}
    </span>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--ff-text-secondary)] ${className ?? ''}`}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 align-top text-[var(--ff-text-primary)] ${className ?? ''}`}>
      {children}
    </td>
  );
}

function formatRand(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
