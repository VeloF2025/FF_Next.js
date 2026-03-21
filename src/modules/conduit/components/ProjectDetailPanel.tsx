/**
 * ProjectDetailPanel — Drill-down detail for a Conduit project.
 * Renders 3 forecast tables: Rollout Plan, COS Categories, Revenue.
 */
'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ForecastRow {
  label: string;
  values: (number | null)[];
  isTotal?: boolean;
}

interface ProjectDetailData {
  projectName: string;
  months: string[];
  rolloutPlan: ForecastRow[];
  cosCategories: ForecastRow[];
  revenueForecast: ForecastRow[];
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function fZAR(v: number | null): string {
  if (v === null || v === 0) return '\u2014';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

function fInt(v: number | null): string {
  if (v === null || v === 0) return '\u2014';
  return Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
}

// ─── Sub-table ───────────────────────────────────────────────────────────────

interface ForecastTableProps {
  title: string;
  months: string[];
  rows: ForecastRow[];
  format: 'int' | 'zar';
}

function ForecastTable({ title, months, rows, format }: ForecastTableProps) {
  const fmt = (v: number | null) => format === 'zar' ? fZAR(v) : fInt(v);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse min-w-max">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th
              className="px-3 py-2 text-left text-white font-bold whitespace-nowrap"
              style={{ minWidth: 180 }}
            >
              {title}
            </th>
            {months.map(m => (
              <th
                key={m}
                className="px-2 py-2 text-right text-white font-semibold whitespace-nowrap"
                style={{ minWidth: 90 }}
              >
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isTotal = Boolean(row.isTotal);
            return (
              <tr
                key={row.label}
                style={isTotal ? { backgroundColor: '#1a3a4a' } : undefined}
                className={!isTotal ? (i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60') : ''}
              >
                <td
                  className={`px-3 py-1.5 whitespace-nowrap ${isTotal ? 'font-bold text-white' : 'text-gray-300'}`}
                >
                  {row.label}
                </td>
                {row.values.map((v, j) => {
                  const isNeg = typeof v === 'number' && v < 0;
                  return (
                    <td
                      key={j}
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        isTotal
                          ? 'font-bold text-white'
                          : isNeg
                          ? 'text-red-400'
                          : 'text-gray-300'
                      }`}
                    >
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  projectName: string;
}

export function ProjectDetailPanel({ projectId, projectName }: Props) {
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`/api/conduit/projects/${projectId}/detail`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(({ data: d }: { data: ProjectDetailData }) => setData(d))
      .catch((err: unknown) => {
        log.error('ProjectDetailPanel fetch failed', { projectId, err: String(err) });
        setError('Failed to load detail data');
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading {projectName} detail\u2026</span>
      </div>
    );
  }

  if (error || !data) {
    return <p className="p-6 text-sm text-red-400">{error ?? 'No data'}</p>;
  }

  return (
    <div className="space-y-4 p-4 bg-gray-900 border-t border-gray-700">
      <ForecastTable
        title="Rollout Plan \u2014 Forecast"
        months={data.months}
        rows={data.rolloutPlan}
        format="int"
      />
      <ForecastTable
        title="COS Category \u2014 Forecast"
        months={data.months}
        rows={data.cosCategories}
        format="zar"
      />
      <ForecastTable
        title="Revenue \u2014 Forecast"
        months={data.months}
        rows={data.revenueForecast}
        format="zar"
      />
    </div>
  );
}
