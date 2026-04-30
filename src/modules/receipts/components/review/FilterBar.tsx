import React from 'react';
import { RotateCcw } from 'lucide-react';
import {
  RECEIPT_CATEGORIES,
  RECEIPT_CATEGORY_LABELS,
  type ReceiptCategory,
} from '@/modules/receipts/categories';
import type { ReceiptStatus } from '@/modules/receipts/queries';
import type { Filters } from './types';
import { EntitySearch, type EntityHit } from './EntitySearch';

interface RawStaffRow {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  email?: unknown;
}

function mapStaffRow(row: unknown): EntityHit | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as RawStaffRow;
  const id = typeof r.id === 'string' ? r.id : null;
  const primary =
    (typeof r.name === 'string' && r.name) ||
    (typeof r.full_name === 'string' && r.full_name) ||
    (typeof r.email === 'string' && r.email) ||
    null;
  if (!id || !primary) return null;
  return {
    id,
    primary,
    secondary: typeof r.email === 'string' ? r.email : undefined,
  };
}

interface RawProjectRow {
  id?: unknown;
  name?: unknown;
  project_name?: unknown;
  project_code?: unknown;
}

function mapProjectRow(row: unknown): EntityHit | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as RawProjectRow;
  const id = typeof r.id === 'string' ? r.id : null;
  const primary =
    (typeof r.project_name === 'string' && r.project_name) ||
    (typeof r.name === 'string' && r.name) ||
    null;
  if (!id || !primary) return null;
  return {
    id,
    primary,
    secondary: typeof r.project_code === 'string' ? r.project_code : undefined,
  };
}

/**
 * Lazy-resolve the display label for a UUID supplied via deep-link
 * (e.g. /staff/receipts?staffId=<uuid>). Without this, the typeahead
 * chip would show a raw UUID until the reviewer clears it.
 */
function useResolvedLabel(
  url: string,
  id: string,
  mapRow: (row: unknown) => EntityHit | null,
  override: string | null
): string | null {
  const [label, setLabel] = React.useState<string | null>(override);
  const resolvedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    // Override path: caller has handed us a fresh label (typeahead pick)
    // — trust it and remember which id it belongs to.
    if (override !== null) {
      setLabel(override);
      resolvedFor.current = id;
      return;
    }
    // Cleared path: nothing selected → drop any stale label state so a
    // later selection doesn't briefly flash the previous chip.
    if (!id) {
      setLabel(null);
      resolvedFor.current = null;
      return;
    }
    // Already resolved this exact id — nothing to do.
    if (resolvedFor.current === id) return;

    // New id and no override: fetch the canonical name. Clear any
    // previous label first so the chip doesn't show the prior staff's
    // name during the in-flight fetch (~100-500ms).
    setLabel(null);

    let cancelled = false;
    fetch(`${url}${url.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`, {
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.success && json.data) {
          const data = Array.isArray(json.data) ? json.data[0] : json.data;
          const hit = mapRow(data);
          if (hit) {
            setLabel(hit.primary);
            resolvedFor.current = id;
          }
        }
      })
      .catch(() => {
        // Fail quietly — chip falls back to UUID.
      });
    return () => {
      cancelled = true;
    };
  }, [id, url, override, mapRow]);

  return label;
}

export function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}) {
  const [staffLabelOverride, setStaffLabelOverride] = React.useState<string | null>(null);
  const [projectLabelOverride, setProjectLabelOverride] = React.useState<string | null>(null);

  const staffLabel = useResolvedLabel(
    '/api/staff',
    filters.staffId,
    mapStaffRow,
    staffLabelOverride
  );
  const projectLabel = useResolvedLabel(
    '/api/projects',
    filters.projectId,
    mapProjectRow,
    projectLabelOverride
  );

  const update = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    onChange({ ...filters, [k]: v });
  };

  const onStaffPick = (id: string, label: string | null) => {
    setStaffLabelOverride(label);
    update('staffId', id);
  };
  const onProjectPick = (id: string, label: string | null) => {
    setProjectLabelOverride(label);
    update('projectId', id);
  };

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Field label="Status">
          <select
            value={filters.status}
            onChange={(e) => update('status', e.target.value as ReceiptStatus | '')}
            className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 px-3 py-2"
          >
            <option value="">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="reconciled">Reconciled</option>
            <option value="rejected">Rejected</option>
          </select>
        </Field>
        <Field label="Category">
          <select
            value={filters.category}
            onChange={(e) => update('category', e.target.value as ReceiptCategory | '')}
            className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 px-3 py-2"
          >
            <option value="">All categories</option>
            {[...RECEIPT_CATEGORIES]
              .sort((a, b) => RECEIPT_CATEGORY_LABELS[a].localeCompare(RECEIPT_CATEGORY_LABELS[b]))
              .map((c) => (
                <option key={c} value={c}>
                  {RECEIPT_CATEGORY_LABELS[c]}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Month">
          <input
            type="month"
            value={filters.month}
            onChange={(e) => update('month', e.target.value)}
            className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 px-3 py-2"
          />
        </Field>
        {/* RBAC note: /api/staff and /api/projects are gated by withAuth
            only (no withPermission). Both endpoints are shared across
            many features, so adding a permission gate here would be a
            cross-cutting change. Bounded mitigation in this PR: enforce
            minChars=3 on the typeahead so single-letter enumeration
            scans return nothing. A broader hardening pass — splitting
            out a permission-gated /api/*-search endpoint — is a
            follow-up tracked alongside the test backlog. */}
        <EntitySearch
          label="Staff"
          placeholder="Search by name or email"
          searchUrl="/api/staff"
          mapRow={mapStaffRow}
          selectedId={filters.staffId}
          selectedLabel={staffLabel}
          onChange={onStaffPick}
          minChars={3}
        />
        <EntitySearch
          label="Project"
          placeholder="Search by name or code"
          searchUrl="/api/projects"
          mapRow={mapProjectRow}
          selectedId={filters.projectId}
          selectedLabel={projectLabel}
          onChange={onProjectPick}
          minChars={3}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setStaffLabelOverride(null);
            setProjectLabelOverride(null);
            onReset();
          }}
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200"
        >
          <RotateCcw className="w-3 h-3" />
          Reset filters
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">{label}</span>
      {children}
    </label>
  );
}
