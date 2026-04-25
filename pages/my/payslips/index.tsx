/**
 * /my/payslips — staff payslip list.
 *
 * PRD-040 Phase 3 / PR2. Renders the signed-in staff's active payslips
 * (latest period first), with a Download button per row. Tapping Download
 * navigates to the proxy endpoint which streams the PDF; the browser
 * triggers its standard "save as" UX with a sensible filename.
 *
 * The hub tile redirects here when the user has at least one payslip.
 * Empty state message handles the "first time signed in, no imports yet"
 * case so the tile copy "No payslips" matches.
 */

import React from 'react';
import { NextPage } from 'next';
import { FileText, Download, AlertCircle } from 'lucide-react';

import {
  listMyPayslips,
  payslipDownloadUrl,
  type PayslipListItem,
} from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: PayslipListItem[] };

const MyPayslipsPage: NextPage & { getLayout?: (page: React.ReactElement) => React.ReactElement } = () => {
  const [state, setState] = React.useState<PageState>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    listMyPayslips()
      .then((res) => {
        if (!cancelled) setState({ kind: 'ready', items: res.items });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Could not load payslips',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MyPortalShell title="Payslips">
      {state.kind === 'loading' && (
        <div className="text-center text-sm text-neutral-400 py-12">Loading…</div>
      )}

      {state.kind === 'error' && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      {state.kind === 'ready' && state.items.length === 0 && (
        <div className="text-center py-16">
          <div className="mx-auto w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center mb-3">
            <FileText className="w-6 h-6 text-neutral-500" />
          </div>
          <div className="text-sm font-medium text-neutral-100">No payslips yet</div>
          <div className="mt-1 text-xs text-neutral-400">
            Your monthly payslips will appear here once HR has imported them.
          </div>
        </div>
      )}

      {state.kind === 'ready' && state.items.length > 0 && (
        <ul className="space-y-2">
          {state.items.map((p) => (
            <li
              key={p.id}
              className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 flex items-center gap-3"
            >
              <span className="flex w-10 h-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 shrink-0">
                <FileText className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-neutral-100 truncate">
                  {formatPeriod(p.payPeriodStart, p.payPeriodEnd)}
                </div>
                <div className="text-xs text-neutral-400 mt-0.5">
                  Net {formatRand(p.netCents)} · Gross {formatRand(p.grossCents)}
                </div>
              </div>
              {p.hasPdf ? (
                <a
                  href={payslipDownloadUrl(p.id)}
                  className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 min-h-[48px] px-4 text-sm font-semibold text-white"
                >
                  <Download className="w-4 h-4" />
                  PDF
                </a>
              ) : (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-500 border border-neutral-800 rounded-full px-2 py-0.5">
                  No PDF
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </MyPortalShell>
  );
};

MyPayslipsPage.getLayout = (page: React.ReactElement) => page;

export default MyPayslipsPage;

function formatRand(cents: number): string {
  const rand = cents / 100;
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(rand);
}

function formatPeriod(start: string, end: string): string {
  const startMonth = monthLabel(start);
  const endMonth = monthLabel(end);
  return startMonth === endMonth ? startMonth : `${startMonth} – ${endMonth}`;
}

function monthLabel(iso: string): string {
  // Treat YYYY-MM-DD as a wall-clock SAST date; year-month is what
  // payroll cares about.
  const [year, month] = iso.split('-');
  const monthIdx = Number(month) - 1;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[monthIdx] ?? month} ${year}`;
}
