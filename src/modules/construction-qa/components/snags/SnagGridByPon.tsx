/**
 * SnagGridByPon — Snag card grid grouped by Zone → PON hierarchy.
 * Used when the user selects "By PON" view mode in SnagsPage.
 * Snags within each PON are sorted by snag_number (grid_index).
 */

'use client';

import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { SnagCard } from './SnagCard';
import { SnagDetail } from './SnagDetail';
import type { Snag, SnagPhoto, ZonePonGroup } from '../../types/snag.types';

// ============================================================
// Props
// ============================================================

interface SnagGridByPonProps {
  projectName: string;
  groups: ZonePonGroup[];
  photosBySnag: Record<string, SnagPhoto[]>;
  loading: boolean;
  onBack: () => void;
  onSnagUpdated: (snag: Snag) => void;
  onPhotoAdded: (snagId: string, photo: SnagPhoto) => void;
  onReportDeleted: (reportId: string) => void;
  onPhotoDeleted: (snagId: string, photoId: string) => void;
}

// ============================================================
// PON sub-section
// ============================================================

interface PonSectionProps {
  ponNo: number | null;
  snags: Snag[];
  photosBySnag: Record<string, SnagPhoto[]>;
  expandedSnagId: string | null;
  onCardClick: (snagId: string) => void;
  onSnagUpdated: (snag: Snag) => void;
  onPhotoAdded: (snagId: string, photo: SnagPhoto) => void;
  onPhotoDeleted: (snagId: string, photoId: string) => void;
}

/** 🟢 WORKING: Collapsible PON section within a zone */
function PonSection({
  ponNo,
  snags,
  photosBySnag,
  expandedSnagId,
  onCardClick,
  onSnagUpdated,
  onPhotoAdded,
  onPhotoDeleted,
}: PonSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const openCount = snags.filter((s) =>
    ['open', 'assigned', 'in_progress', 'reopened'].includes(s.status)
  ).length;
  const fixedCount = snags.filter((s) =>
    ['fixed', 'verified', 'closed'].includes(s.status)
  ).length;

  const label = ponNo != null ? `PON ${ponNo}` : 'No PON';

  return (
    <div className="space-y-2">
      {/* PON header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 text-left bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded-md px-3 py-2 transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
        )}
        <span className="text-xs font-semibold text-zinc-200">{label}</span>
        <span className="text-xs text-zinc-500 ml-1">{snags.length} snag{snags.length !== 1 ? 's' : ''}</span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {openCount > 0 && (
            <span className="text-xs bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">
              {openCount} open
            </span>
          )}
          {fixedCount > 0 && (
            <span className="text-xs bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded">
              {fixedCount} fixed
            </span>
          )}
        </div>
      </button>

      {/* Snag cards */}
      {!collapsed && (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {snags.map((snag) => {
              const photos = photosBySnag[snag.id] ?? [];
              return (
                <SnagCard
                  key={snag.id}
                  snag={snag}
                  photos={photos}
                  isExpanded={expandedSnagId === snag.id}
                  onClick={() => onCardClick(snag.id)}
                />
              );
            })}
          </div>

          {/* Detail panel — full width below grid, shown when a snag in this PON is expanded */}
          {expandedSnagId && (() => {
            const snag = snags.find((s) => s.id === expandedSnagId);
            if (!snag) return null;
            const photos = photosBySnag[snag.id] ?? [];
            return (
              <SnagDetail
                snag={snag}
                photos={photos}
                onClose={() => onCardClick(snag.id)}
                onUpdated={onSnagUpdated}
                onPhotoAdded={(photo) => onPhotoAdded(snag.id, photo)}
                onPhotoDeleted={(photoId) => onPhotoDeleted(snag.id, photoId)}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main component
// ============================================================

/** 🟢 WORKING: Two-level collapsible snag grid grouped by Zone → PON */
export function SnagGridByPon({
  projectName,
  groups,
  photosBySnag,
  loading,
  onBack,
  onSnagUpdated,
  onPhotoAdded,
  onReportDeleted: _onReportDeleted,
  onPhotoDeleted,
}: SnagGridByPonProps) {
  const [expandedSnagId, setExpandedSnagId] = useState<string | null>(null);
  const [collapsedZones, setCollapsedZones] = useState<Set<string>>(new Set());

  const toggleZone = useCallback((zoneKey: string) => {
    setCollapsedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneKey)) next.delete(zoneKey);
      else next.add(zoneKey);
      return next;
    });
  }, []);

  const handleCardClick = useCallback((snagId: string) => {
    setExpandedSnagId((prev) => (prev === snagId ? null : snagId));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 text-zinc-400 animate-spin" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
        <p className="text-sm">No snags found</p>
        <p className="text-xs mt-1">Import a TQR report to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-16">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to {projectName}
      </button>

      {/* Zone groups */}
      {groups.map((group) => {
        const zoneKey = group.zoneNo != null ? String(group.zoneNo) : '__unassigned__';
        const isCollapsed = collapsedZones.has(zoneKey);
        const isUnassigned = group.zoneNo === null;

        return (
          <div key={zoneKey} className="space-y-2">
            {/* Zone header */}
            <button
              type="button"
              onClick={() => toggleZone(zoneKey)}
              className="w-full flex items-center gap-2 text-left bg-zinc-800 hover:bg-zinc-750 border border-zinc-600 rounded-md px-3 py-2.5 transition-colors"
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
              )}
              <span
                className={`text-sm font-bold ${isUnassigned ? 'text-zinc-500 italic' : 'text-zinc-100'}`}
              >
                {group.label}
              </span>
              <span className={`text-xs ml-1 ${isUnassigned ? 'text-zinc-600' : 'text-zinc-500'}`}>
                {group.totalSnags} snag{group.totalSnags !== 1 ? 's' : ''}
              </span>
              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                {group.openCount > 0 && (
                  <span className="text-xs bg-red-900/60 text-red-300 px-1.5 py-0.5 rounded">
                    {group.openCount} open
                  </span>
                )}
                {group.fixedCount > 0 && (
                  <span className="text-xs bg-green-900/60 text-green-300 px-1.5 py-0.5 rounded">
                    {group.fixedCount} fixed
                  </span>
                )}
              </div>
            </button>

            {/* PON sub-sections */}
            {!isCollapsed && (
              <div className="pl-4 space-y-2 border-l border-zinc-700/50">
                {group.pons.map((pon) => {
                  const ponKey = pon.ponNo != null ? String(pon.ponNo) : '__noPon__';
                  return (
                    <PonSection
                      key={ponKey}
                      ponNo={pon.ponNo}
                      snags={pon.snags}
                      photosBySnag={photosBySnag}
                      expandedSnagId={expandedSnagId}
                      onCardClick={handleCardClick}
                      onSnagUpdated={onSnagUpdated}
                      onPhotoAdded={onPhotoAdded}
                      onPhotoDeleted={onPhotoDeleted}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
