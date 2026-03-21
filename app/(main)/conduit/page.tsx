/**
 * Conduit — Project Scenario Modelling
 * Restricted: internal use only (Hein, Lew, Hanro)
 */

import { Lock, TrendingUp } from 'lucide-react';
import { PortfolioTable } from '@/modules/conduit/components/PortfolioTable';
import type { ConduitProject } from '@/modules/conduit/types';
import { calcConduit } from '@/modules/conduit/hooks/useConduitCalc';
import { log } from '@/lib/logger';

// ─── Data fetching ───────────────────────────────────────────────────────────

async function getProjects(): Promise<ConduitProject[]> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3005';
    const res = await fetch(`${baseUrl}/api/conduit/projects`, { cache: 'no-store' });
    if (!res.ok) return [];
    const { data } = (await res.json()) as { data: ConduitProject[] };
    return data ?? [];
  } catch (err) {
    log.error('Conduit: failed to fetch projects', { err: String(err) });
    return [];
  }
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function fZAR(v: number): string {
  if (!isFinite(v) || v === 0) return '\u2014';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

function fPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fNum(v: number): string {
  return Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}

function KpiCard({ label, value, sub, valueClass = 'text-white' }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 px-5 py-4 min-w-[160px]">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ConduitPage() {
  const projects = await getProjects();

  const totals = projects.reduce(
    (acc, p) => {
      const c = calcConduit(p);
      return {
        po_count: acc.po_count + p.po_count,
        revenue: acc.revenue + c.revenue,
        cos_total: acc.cos_total + c.cos_total,
        profit: acc.profit + c.profit,
      };
    },
    { po_count: 0, revenue: 0, cos_total: 0, profit: 0 }
  );
  const portfolioGP = totals.revenue > 0 ? totals.profit / totals.revenue : 0;

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3">
        <TrendingUp className="w-7 h-7 text-teal-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Conduit</h1>
          <p className="text-sm text-gray-400 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Project scenario modelling \u2014 Internal use only
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      {projects.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <KpiCard
            label="Total Homes"
            value={fNum(totals.po_count)}
            sub={`${projects.length} projects`}
          />
          <KpiCard label="Total Revenue" value={fZAR(totals.revenue)} />
          <KpiCard label="Total COS" value={fZAR(totals.cos_total)} />
          <KpiCard
            label="Total Profit"
            value={fZAR(totals.profit)}
            valueClass={totals.profit < 0 ? 'text-red-400' : 'text-emerald-400'}
          />
          <KpiCard
            label="Portfolio GP%"
            value={fPct(portfolioGP)}
            valueClass={
              portfolioGP >= 0.30
                ? 'text-emerald-400'
                : portfolioGP >= 0.10
                ? 'text-amber-400'
                : 'text-red-400'
            }
          />
        </div>
      )}

      {/* Portfolio table */}
      {projects.length === 0 ? (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-12 text-center text-gray-400">
          <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No projects yet</p>
          <p className="text-sm mt-1 text-gray-500">
            Run migration 249 to seed the Lawley test case.
          </p>
        </div>
      ) : (
        <PortfolioTable initialProjects={projects} />
      )}
    </div>
  );
}
