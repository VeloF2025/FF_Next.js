/**
 * Conduit — Project Scenario Modelling
 * Restricted: internal use only (Hein, Lew, Hanro)
 *
 * Two tabs:
 *  - Current: Prospective / Executable / WIP / Actual (live editing)
 *  - Baseline: immutable snapshots saved from Executable rows
 */

import { Lock, TrendingUp } from 'lucide-react';
import { PortfolioTable } from '@/modules/conduit/components/PortfolioTable';
import { ConduitTabs } from '@/modules/conduit/components/ConduitTabs';
import type { ConduitProject, ConduitBaseline } from '@/modules/conduit/types';

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

async function getBaselines(): Promise<ConduitBaseline[]> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3005';
    const res = await fetch(`${baseUrl}/api/conduit/baselines`, { cache: 'no-store' });
    if (!res.ok) return [];
    const { data } = (await res.json()) as { data: ConduitBaseline[] };
    return data ?? [];
  } catch (err) {
    log.error('Conduit: failed to fetch baselines', { err: String(err) });
    return [];
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ConduitPage() {
  const [projects, baselines] = await Promise.all([getProjects(), getBaselines()]);

  const prospectiveProjects = projects.filter(p => p.status === 'prospective');
  const executableProjects  = projects.filter(p => p.status === 'executable');
  const wipProjects         = projects.filter(p => p.status === 'wip');
  const scopingProjects     = projects.filter(p => p.status === 'scoping');

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3">
        <TrendingUp className="w-7 h-7 text-teal-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Conduit</h1>
          <p className="text-sm text-gray-400 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Project scenario modelling — Internal use only
          </p>
        </div>
      </div>

      {/* Tabs — client component handles tab switching */}
      <ConduitTabs
        prospectiveProjects={prospectiveProjects}
        executableProjects={executableProjects}
        wipProjects={wipProjects}
        scopingProjects={scopingProjects}
        initialBaselines={baselines}
      />
    </div>
  );
}
