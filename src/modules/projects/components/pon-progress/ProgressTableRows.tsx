/**
 * Progress Table Row Components
 * CategoryCell, PonRow, and ZoneSection for the PON Progress table
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type {
  ZoneProgressNode,
  PonProgressRow,
  ProgressCategory,
  ProgressStatus,
} from '@/types/pon-stages.types';

const CATEGORIES: ProgressCategory[] = ['cwc', 'optical', 'activation', 'maintenance'];

const STATUS_COLORS: Record<ProgressStatus, { text: string; dot: string }> = {
  complete: { text: 'text-emerald-400', dot: 'bg-emerald-400' },
  on_track: { text: 'text-blue-400', dot: 'bg-blue-400' },
  at_risk: { text: 'text-amber-400', dot: 'bg-amber-400' },
  overdue: { text: 'text-red-400', dot: 'bg-red-400' },
  no_target: { text: 'text-gray-400', dot: 'bg-gray-500' },
};

interface CategoryCellData {
  total: number; complete: number; pct: number;
  target_date: string | null; status: ProgressStatus;
}

function CategoryCell({
  data, ponStageId, category, projectId, onRefresh,
}: {
  data: CategoryCellData; ponStageId: string;
  category: ProgressCategory; projectId: string; onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dateValue, setDateValue] = useState(data.target_date || '');
  const s = STATUS_COLORS[data.status];

  const save = async (v: string) => {
    try {
      await fetch(`/api/projects/${projectId}/pon-progress`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pon_stage_id: ponStageId, action: 'set_target', category, target_date: v || null }),
      });
      setEditing(false);
      onRefresh();
    } catch { /* silent */ }
  };

  return (
    <td className="px-2 py-2 text-center">
      <div className="flex flex-col items-center gap-1">
        <span className={`text-xs font-medium ${s.text}`}>
          {data.complete}/{data.total}
          {data.pct > 0 && <span className="ml-1">({data.pct}%)</span>}
        </span>
        <div className={`w-2 h-2 rounded-full ${s.dot}`} title={data.status.replace('_', ' ')} />
        {editing ? (
          <input type="date" value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            onBlur={() => save(dateValue)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(dateValue); if (e.key === 'Escape') setEditing(false); }}
            autoFocus
            aria-label={`Target date for ${category}`}
            className="w-28 px-1 py-0.5 text-[10px] bg-[var(--ff-bg-secondary)] border border-blue-500 rounded text-[var(--ff-text-primary)]"
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setDateValue(data.target_date || ''); setEditing(true); }}
            title="Click to set target date"
          >
            {data.target_date
              ? new Date(data.target_date + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
              : '+ target'}
          </Button>
        )}
      </div>
    </td>
  );
}

function PonRow({
  pon, projectId, onRefresh, onOpenLog,
}: {
  pon: PonProgressRow; projectId: string; onRefresh: () => void; onOpenLog: () => void;
}) {
  const [editingBlockage, setEditingBlockage] = useState(false);
  const [blockageValue, setBlockageValue] = useState(pon.blockage || '');

  const saveBlockage = async () => {
    try {
      await fetch(`/api/projects/${projectId}/pon-progress`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pon_stage_id: pon.pon_stage_id, action: 'set_blockage', blockage: blockageValue.trim() || null }),
      });
      setEditingBlockage(false);
      onRefresh();
    } catch { /* silent */ }
  };

  return (
    <tr className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors">
      <td className="px-3 py-2 pl-8 text-sm text-[var(--ff-text-secondary)]">PON {pon.pon_no}</td>
      <td className="px-2 py-2 max-w-[140px]">
        {editingBlockage ? (
          <input type="text" value={blockageValue}
            onChange={(e) => setBlockageValue(e.target.value)}
            onBlur={saveBlockage}
            onKeyDown={(e) => { if (e.key === 'Enter') saveBlockage(); if (e.key === 'Escape') setEditingBlockage(false); }}
            autoFocus placeholder="Blockage reason..."
            aria-label="Blockage reason"
            className="w-full px-2 py-0.5 text-xs bg-[var(--ff-bg-secondary)] border border-blue-500 rounded text-[var(--ff-text-primary)]"
          />
        ) : (
          <button type="button"
            onClick={() => { setBlockageValue(pon.blockage || ''); setEditingBlockage(true); }}
            className={`text-xs truncate max-w-full ${pon.blockage ? 'text-red-400' : 'text-[var(--ff-text-secondary)] hover:text-blue-400'}`}
            title={pon.blockage || 'Click to add blockage'}
          >
            {pon.blockage || '\u2014'}
          </button>
        )}
      </td>
      {CATEGORIES.map((cat) => (
        <CategoryCell key={cat} data={pon[cat]} ponStageId={pon.pon_stage_id}
          category={cat} projectId={projectId} onRefresh={onRefresh} />
      ))}
      <td className="px-2 py-2 text-center">
        <button type="button" onClick={onOpenLog}
          className="px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/10 rounded flex items-center gap-1"
          title="Open daily log"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {pon.recent_logs.length > 0 && (
            <span className="px-1 py-0.5 text-[10px] bg-blue-500/20 rounded-full">{pon.recent_logs.length}</span>
          )}
        </button>
      </td>
    </tr>
  );
}

export function ZoneSection({
  zone, isExpanded, onToggle, projectId, onRefresh, onOpenLog,
}: {
  zone: ZoneProgressNode; isExpanded: boolean; onToggle: () => void;
  projectId: string; onRefresh: () => void;
  onOpenLog: (ponStageId: string, ponLabel: string) => void;
}) {
  return (
    <>
      <tr className="bg-[var(--ff-bg-secondary)] cursor-pointer hover:bg-[var(--ff-bg-tertiary)] transition-colors">
        <td className="px-3 py-2 font-medium text-[var(--ff-text-primary)]" colSpan={2}>
          <button type="button" onClick={onToggle}
            aria-expanded={isExpanded}
            className="flex items-center gap-2 w-full text-left focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] rounded"
          >
            <svg className={`w-3 h-3 text-[var(--ff-text-secondary)] transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
              fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            {zone.zone_name}
            <span className="text-xs text-[var(--ff-text-secondary)]">
              ({zone.pons.length} PON{zone.pons.length !== 1 ? 's' : ''})
            </span>
          </button>
        </td>
        {CATEGORIES.map((cat) => <td key={cat} className="px-2 py-2" />)}
        <td />
      </tr>
      {isExpanded && zone.pons.map((pon) => (
        <PonRow key={pon.pon_stage_id} pon={pon} projectId={projectId} onRefresh={onRefresh}
          onOpenLog={() => onOpenLog(pon.pon_stage_id, `Zone ${pon.zone_no} \u2014 PON ${pon.pon_no}`)} />
      ))}
    </>
  );
}
