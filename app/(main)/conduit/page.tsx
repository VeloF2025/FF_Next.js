/**
 * Conduit — Project Scenario Modelling
 * Restricted: internal use only (Hein, Lew, Hanro)
 *
 * KPI tiles live inside PortfolioTable (client component) so they
 * react to inline edits without a page reload.
 */

import { Lock, TrendingUp } from 'lucide-react';
import { PortfolioTable } from '@/modules/conduit/components/PortfolioTable';
import type { ConduitProject } from '@/modules/conduit/types';
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

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ConduitPage() {
  const projects = await getProjects();

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

      {/* PortfolioTable owns tiles + table + Actual section */}
      <PortfolioTable initialProjects={projects} />
    </div>
  );
}
