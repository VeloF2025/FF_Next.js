/**
 * /staff/attendance/reports — Pulse · Reports tile grid (PRD-061 §7.3).
 *
 * Lists the 6 P1 reports with a one-line description and a drill-through
 * to the per-slug page. Late-arrivals (the 7th P1 in the PRD) is deferred
 * to Phase C2 because the underlying shift schedule isn't in the DB yet —
 * surfacing it here as a "coming soon" tile would be misleading.
 */

import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { REPORT_CATALOGUE } from '@/services/attendance/reports/types';

export default function ReportsIndexPage() {
  return (
    <AppLayout>
      <AttendanceNav />
      <div className="px-6 py-6 max-w-6xl mx-auto">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold text-gray-900">Pulse · Reports</h1>
          <p className="text-sm text-gray-500">
            On-demand HR reports. Each report honours your supervisor scope and exports to XLSX or CSV.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {REPORT_CATALOGUE.map((r) => (
            <Link
              key={r.slug}
              href={`/staff/attendance/reports/${r.slug}`}
              className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-emerald-400 hover:shadow-sm transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">{r.title}</div>
                  <div className="mt-1 text-xs text-gray-500">{r.blurb}</div>
                  <div className="mt-2 text-[10px] uppercase tracking-wide text-gray-400 font-mono">
                    /{r.slug}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-6 text-xs text-gray-500">
          Looking for late-arrivals? It&apos;s deferred to a follow-up release — the underlying shift
          schedule isn&apos;t recorded in attendance entries yet, so we can&apos;t compute lateness deterministically.
        </p>
      </div>
    </AppLayout>
  );
}
