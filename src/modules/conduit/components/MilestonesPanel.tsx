/**
 * MilestonesPanel — Prerequisites & Milestones for a conduit project.
 *
 * Groups milestone rows by phase in a defined order.
 * Auto-saves each field on blur/change via PATCH.
 * Auto-inits rows on first load if none exist for the project.
 * Color-codes rows by status: Completed=emerald, Blocked=red, default=gray.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import { log } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MilestoneRow {
  id: string;
  project_id: string;
  milestone_item_id: string;
  phase: string;
  item_name: string;
  sort_order: number;
  responsible: string | null;
  velocity_responsible: string | null;
  fibertime_responsible: string | null;
  planned_date: string | null;
  due_date: string | null;
  actual_date: string | null;
  status: string | null;
  comment: string | null;
}

interface SelectLists {
  Responsible: string[];
  Status: string[];
}

/** Staff member sourced from the HR staff table. */
type StaffOption = { id: string; name: string };

interface Props {
  projectId: string;
  readOnly?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PHASE_ORDER = [
  'Site Assignments',
  'Prerequisites',
  'Site Establishment',
  'Contractor Engagements',
  'Key Milestones',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateValue(v: string | null): string {
  if (!v) return '';
  return v.slice(0, 10);
}

function rowTextClass(status: string | null): string {
  if (status === 'Completed') return 'text-emerald-400';
  if (status === 'Blocked') return 'text-red-400';
  return 'text-gray-300';
}

// ─── Single milestone row ─────────────────────────────────────────────────────

function MilestoneRowItem({
  row,
  index,
  selectLists,
  staffList,
  readOnly,
  onFieldChange,
}: {
  row: MilestoneRow;
  index: number;
  selectLists: SelectLists;
  staffList: StaffOption[];
  readOnly: boolean;
  onFieldChange: (id: string, field: string, value: string | null) => void;
}) {
  const textClass = rowTextClass(row.status);
  const bg = index % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60';
  const inputBase = `bg-transparent border border-transparent hover:border-gray-600 focus:border-teal-500 rounded px-1.5 py-0.5 outline-none w-full transition-colors ${textClass}`;

  const handleBlur = (field: string, value: string) => {
    if (!readOnly) onFieldChange(row.id, field, value || null);
  };

  const handleSelectChange = (field: string, value: string) => {
    if (!readOnly) onFieldChange(row.id, field, value || null);
  };

  return (
    <tr className={bg}>
      <td className={`px-2 py-1 whitespace-nowrap font-medium ${textClass}`}>{row.item_name}</td>

      <td className="px-2 py-1">
        <select
          disabled={readOnly}
          defaultValue={row.responsible ?? ''}
          onChange={e => handleSelectChange('responsible', e.target.value)}
          className={`${inputBase} bg-gray-900`}
        >
          <option value="">—</option>
          {selectLists.Responsible.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </td>

      <td className="px-2 py-1">
        <select
          disabled={readOnly}
          value={row.velocity_responsible ?? ''}
          onChange={e => handleSelectChange('velocity_responsible', e.target.value)}
          className={`${inputBase} bg-gray-900`}
        >
          <option value="">—</option>
          {staffList.map(s => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>
      </td>

      <td className="px-2 py-1">
        <input
          type="text"
          disabled={readOnly}
          defaultValue={row.fibertime_responsible ?? ''}
          onBlur={e => handleBlur('fibertime_responsible', e.target.value)}
          className={inputBase}
        />
      </td>

      <td className="px-2 py-1">
        <input
          type="date"
          disabled={readOnly}
          defaultValue={formatDateValue(row.planned_date)}
          onChange={e => { if (!readOnly) onFieldChange(row.id, 'planned_date', e.target.value || null); }}
          className={`${inputBase} text-[11px]`}
        />
      </td>

      <td className="px-2 py-1">
        <input
          type="date"
          disabled={readOnly}
          defaultValue={formatDateValue(row.due_date)}
          onChange={e => { if (!readOnly) onFieldChange(row.id, 'due_date', e.target.value || null); }}
          className={`${inputBase} text-[11px]`}
        />
      </td>

      <td className="px-2 py-1">
        <input
          type="date"
          disabled={readOnly}
          defaultValue={formatDateValue(row.actual_date)}
          onChange={e => { if (!readOnly) onFieldChange(row.id, 'actual_date', e.target.value || null); }}
          className={`${inputBase} text-[11px]`}
        />
      </td>

      <td className="px-2 py-1">
        <select
          disabled={readOnly}
          defaultValue={row.status ?? ''}
          onChange={e => handleSelectChange('status', e.target.value)}
          className={`${inputBase} bg-gray-900`}
        >
          <option value="">—</option>
          {selectLists.Status.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </td>

      <td className="px-2 py-1">
        <input
          type="text"
          disabled={readOnly}
          defaultValue={row.comment ?? ''}
          onBlur={e => handleBlur('comment', e.target.value)}
          className={inputBase}
        />
      </td>
    </tr>
  );
}

// ─── Phase section ────────────────────────────────────────────────────────────

function PhaseSection({
  phase,
  rows,
  selectLists,
  staffList,
  readOnly,
  onFieldChange,
}: {
  phase: string;
  rows: MilestoneRow[];
  selectLists: SelectLists;
  staffList: StaffOption[];
  readOnly: boolean;
  onFieldChange: (id: string, field: string, value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const completed = rows.filter(r => r.status === 'Completed').length;

  return (
    <div className="rounded border border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-750 text-xs font-semibold text-gray-300 hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          {phase}
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
            completed === rows.length && rows.length > 0
              ? 'bg-emerald-900 text-emerald-300'
              : 'bg-gray-700 text-gray-400'
          }`}>
            {completed} / {rows.length}
          </span>
        </span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-max">
            <thead>
              <tr className="bg-gray-850 border-b border-gray-700">
                <th className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap" style={{ minWidth: 180 }}>Item</th>
                <th className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap" style={{ minWidth: 120 }}>Responsible</th>
                <th className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap" style={{ minWidth: 120 }}>Staff Member</th>
                <th className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap" style={{ minWidth: 120 }}>FT Person</th>
                <th className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap" style={{ minWidth: 100 }}>Planned</th>
                <th className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap" style={{ minWidth: 100 }}>Due</th>
                <th className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap" style={{ minWidth: 100 }}>Actual</th>
                <th className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap" style={{ minWidth: 120 }}>Status</th>
                <th className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap" style={{ minWidth: 180 }}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <MilestoneRowItem
                  key={row.id}
                  row={row}
                  index={i}
                  selectLists={selectLists}
                  staffList={staffList}
                  readOnly={readOnly}
                  onFieldChange={onFieldChange}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function MilestonesPanel({ projectId, readOnly = false }: Props) {
  const [rows, setRows] = useState<MilestoneRow[]>([]);
  const [selectLists, setSelectLists] = useState<SelectLists>({ Responsible: [], Status: [] });
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMilestones = useCallback(async (): Promise<MilestoneRow[]> => {
    const res = await fetch(`/api/conduit/milestones?projectId=${projectId}`);
    if (!res.ok) throw new Error('Failed to fetch milestones');
    const { data } = await res.json() as { data: MilestoneRow[] };
    return data ?? [];
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);

        const [milestones, slRes, staffRes] = await Promise.all([
          fetchMilestones(),
          fetch('/api/conduit/selectlists'),
          fetch('/api/conduit/staff'),
        ]);

        if (cancelled) return;

        const slData = await slRes.json() as { data: SelectLists };
        setSelectLists(slData.data ?? { Responsible: [], Status: [] });

        if (!staffRes.ok) throw new Error('Failed to fetch staff');
        const staffData = await staffRes.json() as { data: StaffOption[] };
        if (staffData.data) setStaffList(staffData.data);

        if (milestones.length === 0) {
          // Auto-init rows from conduit_milestone_items for this project
          await fetch(`/api/conduit/milestones?projectId=${projectId}`, { method: 'POST' });
          if (cancelled) return;
          const fresh = await fetchMilestones();
          if (!cancelled) setRows(fresh);
        } else {
          setRows(milestones);
        }
      } catch (err) {
        log.error('MilestonesPanel load failed', { projectId, err: String(err) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [projectId, fetchMilestones]);

  const handleFieldChange = useCallback(async (id: string, field: string, value: string | null) => {
    // Optimistic update
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));

    try {
      const res = await fetch(`/api/conduit/milestones/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        log.error('MilestonesPanel PATCH failed', { id, field, status: res.status });
      }
    } catch (err) {
      log.error('MilestonesPanel PATCH error', { id, field, err: String(err) });
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-gray-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading milestones…
      </div>
    );
  }

  const totalCompleted = rows.filter(r => r.status === 'Completed').length;

  // Group by phase in defined order; catch unrecognised phases at end
  const byPhase = new Map<string, MilestoneRow[]>();
  for (const phase of PHASE_ORDER) byPhase.set(phase, []);
  for (const row of rows) {
    if (!byPhase.has(row.phase)) byPhase.set(row.phase, []);
    byPhase.get(row.phase)!.push(row);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-400">Overall progress:</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
          totalCompleted === rows.length && rows.length > 0
            ? 'bg-emerald-900 text-emerald-300'
            : 'bg-gray-700 text-gray-300'
        }`}>
          {totalCompleted} / {rows.length} complete
        </span>
      </div>

      {Array.from(byPhase.entries()).map(([phase, phaseRows]) => {
        if (phaseRows.length === 0) return null;
        return (
          <PhaseSection
            key={phase}
            phase={phase}
            rows={phaseRows}
            selectLists={selectLists}
            staffList={staffList}
            readOnly={readOnly}
            onFieldChange={handleFieldChange}
          />
        );
      })}

      {rows.length === 0 && (
        <p className="text-xs text-gray-500 italic py-4">
          No milestone items found. Check that conduit_milestone_items has seed data.
        </p>
      )}
    </div>
  );
}
