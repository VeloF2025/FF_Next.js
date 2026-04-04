/**
 * Hierarchy Tree Component
 * Activate-style expandable tree: Zone > PON > Feature Type
 */

'use client';

import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, MapPin, Cable, Zap } from 'lucide-react';
import type { QAHierarchy, QAHierarchyZone, QAHierarchyPon, QAHierarchyFeature } from '../types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface HierarchyTreeProps {
  hierarchy: QAHierarchy | null;
  loading: boolean;
  selectedZone?: number | null;
  selectedPon?: number | null;
  selectedFeatureType?: string;
  selectedFeatureId?: string;
  onSelectNode: (zoneNo?: number | null, ponNo?: number | null, featureType?: string, featureId?: string) => void;
  onClearSelection: () => void;
}

export function HierarchyTree({
  hierarchy,
  loading,
  selectedZone,
  selectedPon,
  selectedFeatureType,
  selectedFeatureId,
  onSelectNode,
  onClearSelection,
}: HierarchyTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (!hierarchy || hierarchy.zones.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <MapPin className="w-8 h-8 mx-auto mb-2 text-[var(--ff-text-tertiary)]" />
        <p className="text-xs text-[var(--ff-text-tertiary)]">No zones found</p>
        <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">Select a project first</p>
      </div>
    );
  }

  // "All" row — show totals and clear selection
  const isAllSelected = selectedZone === undefined;

  return (
    <div className="py-1">
      {/* All Photos row */}
      <button
        onClick={onClearSelection}
        className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
          isAllSelected
            ? 'bg-blue-500/15 text-blue-400 font-medium'
            : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
        }`}
      >
        <span>All Photos</span>
        <CountBadge count={hierarchy.totals.photo_count} />
      </button>

      {/* Zone rows */}
      {hierarchy.zones.map(zone => (
        <ZoneRow
          key={`zone_${zone.zone_no}`}
          zone={zone}
          expanded={expanded}
          selectedZone={selectedZone}
          selectedPon={selectedPon}
          selectedFeatureType={selectedFeatureType}
          selectedFeatureId={selectedFeatureId}
          onToggle={toggleExpand}
          onSelect={onSelectNode}
        />
      ))}
    </div>
  );
}

interface ZoneRowProps {
  zone: QAHierarchyZone;
  expanded: Set<string>;
  selectedZone?: number | null;
  selectedPon?: number | null;
  selectedFeatureType?: string;
  selectedFeatureId?: string;
  onToggle: (key: string, e: React.MouseEvent) => void;
  onSelect: (zoneNo?: number | null, ponNo?: number | null, featureType?: string, featureId?: string) => void;
}

function ZoneRow({ zone, expanded, selectedZone, selectedPon, selectedFeatureType, selectedFeatureId, onToggle, onSelect }: ZoneRowProps) {
  const zoneKey = `zone_${zone.zone_no}`;
  const isExpanded = expanded.has(zoneKey);
  const isSelected = selectedZone === zone.zone_no && selectedPon === undefined;
  const isActive = selectedZone === zone.zone_no;
  const label = zone.zone_no !== null ? `Zone ${zone.zone_no}` : 'Unassigned';

  return (
    <div>
      <button
        onClick={() => onSelect(zone.zone_no)}
        className={`w-full flex items-center gap-1 px-3 py-2 text-sm transition-colors group ${
          isSelected
            ? 'bg-blue-500/15 text-blue-400 font-medium'
            : isActive
            ? 'text-blue-300'
            : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
        }`}
      >
        <span
          onClick={(e) => toggleExpand(e)}
          className="flex-shrink-0 p-0.5 hover:bg-[var(--ff-bg-tertiary)] rounded cursor-pointer"
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
        <span className="flex-1 text-left truncate">{label}</span>
        <StatusDots pending={zone.pending} approved={zone.approved} rejected={zone.rejected} />
        <CountBadge count={zone.photo_count} />
      </button>

      {isExpanded && (
        <div className="ml-4">
          {zone.pons.map(pon => (
            <PonRow
              key={`pon_${zone.zone_no}_${pon.pon_no}`}
              pon={pon}
              zoneNo={zone.zone_no}
              expanded={expanded}
              selectedZone={selectedZone}
              selectedPon={selectedPon}
              selectedFeatureType={selectedFeatureType}
              selectedFeatureId={selectedFeatureId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );

  function toggleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    onToggle(zoneKey, e);
  }
}

interface PonRowProps {
  pon: QAHierarchyPon;
  zoneNo: number | null;
  expanded: Set<string>;
  selectedZone?: number | null;
  selectedPon?: number | null;
  selectedFeatureType?: string;
  selectedFeatureId?: string;
  onToggle: (key: string, e: React.MouseEvent) => void;
  onSelect: (zoneNo?: number | null, ponNo?: number | null, featureType?: string, featureId?: string) => void;
}

function PonRow({ pon, zoneNo, expanded, selectedZone, selectedPon, selectedFeatureType, selectedFeatureId, onToggle, onSelect }: PonRowProps) {
  const ponKey = `pon_${zoneNo}_${pon.pon_no}`;
  const isExpanded = expanded.has(ponKey);
  const isSelected = selectedZone === zoneNo && selectedPon === pon.pon_no && selectedFeatureId === undefined;
  const isActive = selectedZone === zoneNo && selectedPon === pon.pon_no;
  const label = pon.pon_no !== null ? `PON ${pon.pon_no}` : 'Unassigned';
  const hasFeatures = pon.features && pon.features.length > 0;

  return (
    <div>
      <button
        onClick={() => onSelect(zoneNo, pon.pon_no)}
        className={`w-full flex items-center gap-1 px-2 py-1.5 text-sm transition-colors ${
          isSelected
            ? 'bg-blue-500/15 text-blue-400 font-medium'
            : isActive
            ? 'text-blue-300'
            : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
        }`}
      >
        {hasFeatures ? (
          <span
            onClick={(e) => toggleExpand(e)}
            className="flex-shrink-0 p-0.5 hover:bg-[var(--ff-bg-tertiary)] rounded cursor-pointer"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        <span className="flex-1 text-left truncate">{label}</span>
        <StatusDots pending={pon.pending} approved={pon.approved} rejected={pon.rejected} />
        <CountBadge count={pon.photo_count} small />
      </button>

      {isExpanded && hasFeatures && (
        <div className="ml-5">
          {pon.features.map(feat => (
            <FeatureRow
              key={`feat_${zoneNo}_${pon.pon_no}_${feat.feature_id}`}
              feature={feat}
              isSelected={
                selectedZone === zoneNo &&
                selectedPon === pon.pon_no &&
                selectedFeatureId === feat.feature_id
              }
              onSelect={() => onSelect(zoneNo, pon.pon_no, undefined, feat.feature_id)}
            />
          ))}
        </div>
      )}
    </div>
  );

  function toggleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    onToggle(ponKey, e);
  }
}

interface FeatureRowProps {
  feature: QAHierarchyFeature;
  isSelected: boolean;
  onSelect: () => void;
}

function FeatureRow({ feature, isSelected, onSelect }: FeatureRowProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs transition-colors ${
        isSelected
          ? 'bg-blue-500/15 text-blue-400 font-medium'
          : 'text-[var(--ff-text-tertiary)] hover:bg-[var(--ff-bg-tertiary)] hover:text-[var(--ff-text-secondary)]'
      }`}
    >
      <FeatureTypeIcon workType={feature.work_type} />
      <span className="flex-1 text-left truncate">{feature.feature_id}</span>
      <StatusDots pending={feature.pending} approved={feature.approved} rejected={feature.rejected} />
      <CountBadge count={feature.photo_count} small />
    </button>
  );
}

function FeatureTypeIcon({ workType }: { workType: string }) {
  const cls = 'w-3 h-3';
  switch (workType) {
    case 'pole_installation':
      return <MapPin className={cls} />;
    case 'cable_stringing':
      return <Cable className={cls} />;
    case 'dome_joint':
      return <Zap className={cls} />;
    default:
      return <MapPin className={cls} />;
  }
}

function CountBadge({ count, small }: { count: number; small?: boolean }) {
  return (
    <span className={`flex-shrink-0 px-1.5 rounded-full bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] font-medium ${
      small ? 'text-[10px] py-0' : 'text-xs py-0.5'
    }`}>
      {count}
    </span>
  );
}

function StatusDots({ pending, approved, rejected }: { pending: number; approved: number; rejected: number }) {
  const total = pending + approved + rejected;
  if (total === 0) return null;

  return (
    <div className="flex gap-0.5 flex-shrink-0">
      {pending > 0 && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" title={`${pending} pending`} />}
      {approved > 0 && <span className="w-1.5 h-1.5 rounded-full bg-green-500" title={`${approved} approved`} />}
      {rejected > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-500" title={`${rejected} rejected`} />}
    </div>
  );
}

function formatWorkType(workType: string): string {
  switch (workType) {
    case 'pole_installation': return 'Poles';
    case 'cable_stringing': return 'Cables';
    case 'dome_joint': return 'Dome Joints';
    case 'activation': return 'Activation';
    default: return workType.charAt(0).toUpperCase() + workType.slice(1).replace(/_/g, ' ');
  }
}

export default HierarchyTree;
