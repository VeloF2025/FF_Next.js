/**
 * Project Detail Page
 *
 * Hierarchical view: Zone accordion → PON rows → Feature table.
 * Reads query params for deep-linking: ?zone=4&pon=12&highlight=UUID
 * Discipline filter tabs across top.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { log } from '@/lib/logger';
import type { ZoneNode } from '../../types/dashboard.types';
import { GlobalSearchBar } from '../shared/GlobalSearchBar';
import { ZoneAccordionHeader } from './ZoneAccordionHeader';
import { PonRow } from './PonRow';
import { PonFeaturesPanel } from './PonFeaturesPanel';

interface ProjectDetailPageProps {
  projectId: string;
  projectName?: string;
}

type DisciplineFilter = '' | 'civil' | 'optical' | 'splicing';

const DISCIPLINE_TABS: { key: DisciplineFilter; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'civil', label: 'Civil' },
  { key: 'optical', label: 'Optical' },
  { key: 'splicing', label: 'Splicing' },
];

export function ProjectDetailPage({ projectId, projectName }: ProjectDetailPageProps) {
  const router = useRouter();
  const [zones, setZones] = useState<ZoneNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [discipline, setDiscipline] = useState<DisciplineFilter>('');
  const [expandedZones, setExpandedZones] = useState<Set<number>>(new Set());
  const [selectedPon, setSelectedPon] = useState<{ zone: number; pon: number } | null>(null);
  const [highlightId, setHighlightId] = useState<string | undefined>();
  const [name, setName] = useState(projectName || '');

  // Read deep-link params on mount
  useEffect(() => {
    const { zone, pon, highlight } = router.query;
    if (zone) {
      const zoneNum = Number(zone);
      setExpandedZones(new Set([zoneNum]));
      if (pon) {
        setSelectedPon({ zone: zoneNum, pon: Number(pon) });
      }
    }
    if (highlight) {
      setHighlightId(highlight as string);
    }
  }, [router.query]);

  const fetchZones = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId });
      if (discipline) params.set('discipline', discipline);

      const res = await fetch(`/api/construction-qa/zone-hierarchy?${params}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setZones(data.data?.zones || []);
      }
    } catch (err) {
      log.error('Failed to fetch zones', { error: (err as Error).message }, 'construction-qa');
    } finally {
      setLoading(false);
    }
  }, [projectId, discipline]);

  // Fetch project name if not provided
  useEffect(() => {
    if (!name) {
      fetch('/api/construction-qa/features?action=projects', { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          const projects = data.data?.projects || [];
          const match = projects.find((p: { id: string }) => p.id === projectId);
          if (match) setName(match.name);
        })
        .catch(() => { /* silently ignore */ });
    }
  }, [projectId, name]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  const toggleZone = (zoneNo: number) => {
    setExpandedZones(prev => {
      const next = new Set(prev);
      if (next.has(zoneNo)) {
        next.delete(zoneNo);
      } else {
        next.add(zoneNo);
      }
      return next;
    });
  };

  const handleSelectPon = (zoneNo: number, ponNo: number) => {
    setSelectedPon({ zone: zoneNo, pon: ponNo });
    setHighlightId(undefined);
  };

  const totalFeatures = zones.reduce((sum, z) => sum + z.total, 0);
  const totalApproved = zones.reduce((sum, z) => sum + z.approved, 0);

  return (
    <div className="space-y-4">
      {/* Top bar: back + search */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/field-ops')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-white bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          All Projects
        </button>
        <GlobalSearchBar />
        <button
          onClick={fetchZones}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-white bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-colors ml-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Project header + stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">{name || 'Loading...'}</h2>
          <p className="text-sm text-gray-400">
            {totalFeatures} features · {totalApproved} approved
            ({totalFeatures > 0 ? Math.round((totalApproved / totalFeatures) * 100) : 0}%)
          </p>
        </div>
      </div>

      {/* Discipline tabs */}
      <div className="flex gap-1 bg-[var(--card-bg)] p-1 rounded-lg border border-[var(--border-color)]">
        {DISCIPLINE_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setDiscipline(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              discipline === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-[var(--hover-bg)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Zone accordion */}
      {loading && zones.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Loading zones...
        </div>
      ) : zones.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          No zones found for this project.
        </div>
      ) : (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg divide-y divide-[var(--border-color)] overflow-hidden">
          {zones.map(zone => (
            <div key={zone.zone_no}>
              <ZoneAccordionHeader
                zone={zone}
                expanded={expandedZones.has(zone.zone_no)}
                onToggle={() => toggleZone(zone.zone_no)}
              />
              {expandedZones.has(zone.zone_no) && (
                <div className="border-t border-[var(--border-color)] bg-gray-900/30">
                  {zone.pons.length === 0 ? (
                    <div className="px-4 py-3 pl-12 text-xs text-gray-500">
                      No PONs in this zone.
                    </div>
                  ) : (
                    zone.pons.map(pon => (
                      <PonRow
                        key={pon.pon_no}
                        pon={pon}
                        selected={selectedPon?.zone === zone.zone_no && selectedPon?.pon === pon.pon_no}
                        onSelect={() => handleSelectPon(zone.zone_no, pon.pon_no)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Selected PON feature table */}
      {selectedPon && (
        <PonFeaturesPanel
          projectId={projectId}
          zoneNo={selectedPon.zone}
          ponNo={selectedPon.pon}
          highlightId={highlightId}
        />
      )}
    </div>
  );
}
