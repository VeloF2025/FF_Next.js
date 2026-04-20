/**
 * Uptake Report — first concrete use of the reusable ReportTemplate.
 *
 * The template lives in `src/templates/reports/`. This page:
 *   1. Lets the user pick a project
 *   2. Fetches aggregated PON uptake from /api/reports/uptake
 *   3. Renders the report HTML inside an iframe (what the PDF will look like)
 *   4. Downloads the PDF via /api/reports/uptake-pdf
 *
 * To build another report (snags, km driven, GPS audit) clone this file, swap
 * `buildUptakeReport` for the new domain's mapper, and point at the matching
 * /api/reports/* endpoint.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, Download, FileText, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/auth.types';
import {
  generateReportHtml,
  buildUptakeReport,
} from '@/templates/reports';
import type { UptakeReportPayload } from '../api/reports/uptake';

interface ProjectOption {
  id: string;
  name: string;
}

function formatPeriodLabel(): string {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function buildReportId(projectName: string): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const slug =
    projectName
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toUpperCase()
      .slice(0, 12) || 'PROJECT';
  return `VF-${year}${month}-UPTK-${slug}-PREVIEW`;
}

export default function UptakeReportPage() {
  const router = useRouter();
  const { hasPermission, currentUser } = useAuth();

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [payload, setPayload] = useState<UptakeReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load projects ────────────────────────────────────────────────
  useEffect(() => {
    if (!hasPermission(Permission.ANALYTICS_READ)) {
      router.replace('/dashboard');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/projects?status=active');
        if (!res.ok) throw new Error(`Projects API ${res.status}`);
        const json = await res.json();
        const list: ProjectOption[] = (json.data ?? json ?? [])
          .map((p: { id: string; name?: string; project_name?: string }) => ({
            id: p.id,
            name: p.name ?? p.project_name ?? 'Unnamed project',
          }))
          .sort((a: ProjectOption, b: ProjectOption) => a.name.localeCompare(b.name));
        setProjects(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      }
    })();
  }, [hasPermission, router]);

  // ── Fetch uptake payload for selected project ────────────────────
  const fetchPayload = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/uptake?projectId=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Uptake API ${res.status}`);
      const json = await res.json();
      setPayload((json.data ?? json) as UptakeReportPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load uptake data');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) void fetchPayload(projectId);
  }, [projectId, fetchPayload]);

  // ── Build report data + HTML preview ─────────────────────────────
  const reportHtml = useMemo(() => {
    if (!payload) return null;
    const reportData = buildUptakeReport({
      projectName: payload.projectName,
      periodLabel: formatPeriodLabel(),
      reportId: buildReportId(payload.projectName),
      generatedBy: currentUser?.displayName ?? currentUser?.email ?? 'FibreFlow',
      generatedAt: new Date().toISOString(),
      companyName: 'VelocityFibre',
      targetPct: payload.targetPct,
      pons: payload.pons,
    });
    return generateReportHtml(reportData);
  }, [payload, currentUser]);

  const downloadUrl = projectId
    ? `/api/reports/uptake-pdf?projectId=${encodeURIComponent(projectId)}`
    : '';

  return (
    <AppLayout>
      <Head>
        <title>Uptake Report | FibreFlow</title>
      </Head>

      <div className="ff-page-container">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              aria-label="Back to dashboard"
              className="p-2 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-secondary)]"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Uptake Report</h1>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                PON-level activation vs target · Uses the reusable ReportTemplate
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => projectId && fetchPayload(projectId)}
              disabled={!projectId || loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors text-sm text-[var(--ff-text-primary)] disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </button>
            <a
              href={downloadUrl || '#'}
              aria-disabled={!projectId}
              onClick={(e) => {
                if (!projectId) e.preventDefault();
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                projectId
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
              }`}
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              Download PDF
            </a>
          </div>
        </div>

        {/* Controls bar */}
        <div className="mb-4 flex flex-wrap items-center gap-3 p-3 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
          <label
            htmlFor="project-select"
            className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide"
          >
            Project
          </label>
          <select
            id="project-select"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="px-3 py-1.5 rounded-md text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-emerald-500/50 cursor-pointer min-w-[240px]"
          >
            <option value="">— Select a project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {payload && (
            <span className="ml-auto text-xs text-[var(--ff-text-tertiary)]">
              {payload.pons.length} PON{payload.pons.length === 1 ? '' : 's'} · target{' '}
              {payload.targetPct}%
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!projectId && !error && (
          <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-12 text-center">
            <FileText
              className="w-10 h-10 text-[var(--ff-text-tertiary)] mx-auto mb-3"
              aria-hidden="true"
            />
            <p className="text-sm text-[var(--ff-text-secondary)]">Select a project to generate the report</p>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              Preview will match the downloaded PDF exactly
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-12 text-center">
            <RefreshCw
              className="w-8 h-8 text-[var(--ff-text-tertiary)] mx-auto mb-3 animate-spin"
              aria-hidden="true"
            />
            <p className="text-sm text-[var(--ff-text-secondary)]">Building report…</p>
          </div>
        )}

        {/* No data state */}
        {!loading && payload && payload.pons.length === 0 && (
          <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-12 text-center">
            <p className="text-sm text-[var(--ff-text-secondary)]">
              No PON data for this project yet.
            </p>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              Make sure drops have been imported and PON numbers assigned.
            </p>
          </div>
        )}

        {/* Report preview (iframe = pixel-accurate match to the PDF) */}
        {!loading && reportHtml && payload && payload.pons.length > 0 && (
          <div className="rounded-lg border border-[var(--ff-border-light)] overflow-hidden bg-[#0F172A]">
            <iframe
              title="Uptake Report preview"
              srcDoc={reportHtml}
              className="w-full block"
              style={{ height: '1200px', border: '0' }}
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
