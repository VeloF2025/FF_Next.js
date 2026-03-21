/**
 * Conduit — Project Scenario Modelling
 * Restricted: internal use only (Hein, Lew, Hanro)
 */

import { Lock, TrendingUp } from 'lucide-react';
import { PortfolioTable } from '@/modules/conduit/components/PortfolioTable';
import type { ConduitProject } from '@/modules/conduit/types';

async function getProjects(): Promise<ConduitProject[]> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3005';
    const res = await fetch(`${baseUrl}/api/conduit/projects`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const { data } = await res.json() as { data: ConduitProject[] };
    return data ?? [];
  } catch {
    return [];
  }
}

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
            Project scenario modelling — Internal use only
          </p>
        </div>
      </div>

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
