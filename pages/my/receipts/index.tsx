/**
 * /my/receipts — staff's own receipt list, latest first.
 *
 * Empty state guides field staff to capture their first receipt.
 * Each row links to /my/receipts/[id] for the detail / edit view.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { NextPage } from 'next';
import { Receipt, Plus, AlertCircle, Eye } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import {
  listMyReceipts,
  receiptDownloadUrl,
  type ReceiptListItem,
} from '@/modules/receipts/client/api';
import {
  RECEIPT_CATEGORY_LABELS,
  type ReceiptCategory,
} from '@/modules/receipts/categories';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: ReceiptListItem[] };

const MyReceiptsPage: NextPage & { getLayout?: (p: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
  const [state, setState] = React.useState<State>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    listMyReceipts()
      .then((res) => {
        if (!cancelled) setState({ kind: 'ready', items: res.items });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Could not load receipts',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MyPortalShell title="Receipts">
      <button
        type="button"
        onClick={() => router.push('/my/receipts/new')}
        className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold mb-4"
      >
        <Plus className="w-4 h-4" />
        New receipt
      </button>

      {state.kind === 'loading' && (
        <div className="text-center text-sm text-neutral-400 py-12">Loading…</div>
      )}

      {state.kind === 'error' && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      {state.kind === 'ready' && state.items.length === 0 && (
        <div className="text-center py-12">
          <div className="mx-auto w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center mb-3">
            <Receipt className="w-6 h-6 text-neutral-500" />
          </div>
          <div className="text-sm font-medium text-neutral-100">No receipts yet</div>
          <div className="mt-1 text-xs text-neutral-400">
            Tap &ldquo;New receipt&rdquo; above to capture your first one.
          </div>
        </div>
      )}

      {state.kind === 'ready' && state.items.length > 0 && (
        <ul className="space-y-2">
          {state.items.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
            >
              <button
                type="button"
                onClick={() => router.push(`/my/receipts/${r.id}`)}
                className="w-full text-left flex items-start gap-3"
              >
                <span className="flex w-10 h-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 shrink-0 mt-0.5">
                  <Receipt className="w-5 h-5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-neutral-100 truncate">
                      {r.vendor || 'Unknown vendor'}
                    </span>
                    <span className="text-sm font-semibold text-neutral-100 tabular-nums shrink-0">
                      {formatRand(r.totalCents)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
                    <span>{formatDate(r.receiptDate)}</span>
                    <span>·</span>
                    <span>{RECEIPT_CATEGORY_LABELS[r.category as ReceiptCategory] ?? r.category}</span>
                    <StatusPill status={r.status} />
                  </div>
                </div>
              </button>
              {r.hasImage && (
                <div className="mt-2 pt-2 border-t border-neutral-800 flex justify-end">
                  <a
                    href={receiptDownloadUrl(r.id)}
                    className="inline-flex items-center gap-1 min-h-[48px] px-3 text-xs font-medium text-blue-300 hover:text-blue-200"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    View image
                  </a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </MyPortalShell>
  );
};

MyReceiptsPage.getLayout = (p) => p;

export default MyReceiptsPage;

function formatRand(cents: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`;
}

function StatusPill({ status }: { status: ReceiptListItem['status'] }) {
  if (status === 'submitted') return null;
  const cls =
    status === 'approved'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : status === 'rejected'
        ? 'bg-red-950/50 text-red-300 border-red-800'
        : 'bg-blue-500/15 text-blue-300 border-blue-500/30'; // reconciled
  return (
    <>
      <span>·</span>
      <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full border ${cls}`}>
        {status}
      </span>
    </>
  );
}
