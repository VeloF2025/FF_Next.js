'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Package, ChevronDown, ChevronRight } from 'lucide-react';
import type { StockImplication, Confidence } from './stockImplicationsData';
import { computeImplicationStats } from './stockImplicationsData';

interface StockImplicationsTabProps {
  data: StockImplication[];
}

const CONFIDENCE_STYLES: Record<Confidence, { style: React.CSSProperties; icon: React.ReactNode; label: string }> = {
  exact: {
    style: { background: 'color-mix(in srgb, var(--ff-success) 15%, transparent)', color: 'var(--ff-success)' },
    icon: <CheckCircle2 className="w-3 h-3" aria-hidden="true" />,
    label: 'Exact',
  },
  estimated: {
    style: { background: 'color-mix(in srgb, var(--ff-warning) 15%, transparent)', color: 'var(--ff-warning)' },
    icon: <AlertTriangle className="w-3 h-3" aria-hidden="true" />,
    label: 'Estimated',
  },
  derived: {
    style: { background: 'color-mix(in srgb, var(--ff-primary) 15%, transparent)', color: 'var(--ff-primary)' },
    icon: <HelpCircle className="w-3 h-3" aria-hidden="true" />,
    label: 'Derived',
  },
};

const CATEGORY_COLORS: Record<string, string> = {
  POLES: 'var(--ff-warning)',
  HARDWARE: 'var(--ff-text-secondary)',
  CABLES: 'var(--ff-primary)',
  ENCLOSURES: 'var(--ff-accent)',
  SPLICING: 'var(--ff-info)',
  CIVIL: 'var(--ff-warning)',
  HOME_CONNECTION: 'var(--ff-success)',
  CONSUMABLES: 'var(--ff-text-tertiary)',
};

export const StockImplicationsTab: React.FC<StockImplicationsTabProps> = ({ data }) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(data.map(d => d.id)));
  const [filterLayer, setFilterLayer] = useState<string>('all');

  const stats = useMemo(() => computeImplicationStats(data), [data]);
  const layers = useMemo(() => [...new Set(data.map(d => d.layer))], [data]);

  const filtered = useMemo(() => {
    if (filterLayer === 'all') return data;
    return data.filter(d => d.layer === filterLayer);
  }, [data, filterLayer]);

  const grouped = useMemo(() => {
    const groups = new Map<string, StockImplication[]>();
    for (const item of filtered) {
      if (!groups.has(item.layer)) groups.set(item.layer, []);
      groups.get(item.layer)!.push(item);
    }
    return Array.from(groups.entries()).map(([layer, items]) => ({ layer, items }));
  }, [filtered]);

  const toggleExpand = (id: string): void => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = (): void => setExpandedIds(new Set(filtered.map(d => d.id)));
  const collapseAll = (): void => setExpandedIds(new Set());

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Trigger Events', value: stats.totalImplications, color: 'var(--ff-text-primary)' },
          { label: 'Material Items', value: stats.totalMaterials, color: 'var(--ff-accent)' },
          { label: 'Exact', value: stats.byConfidence.exact, color: 'var(--ff-success)' },
          { label: 'Estimated', value: stats.byConfidence.estimated, color: 'var(--ff-warning)' },
          { label: 'Derived', value: stats.byConfidence.derived, color: 'var(--ff-primary)' },
          { label: 'Gap Blockers', value: stats.gapBlockers, color: 'var(--ff-danger)' },
        ].map(stat => (
          <div key={stat.label} className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
            <div className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</div>
            <div className="text-xs text-[var(--ff-text-tertiary)]">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filter + Expand/Collapse */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterLayer}
          onChange={e => setFilterLayer(e.target.value)}
          aria-label="Filter by QField layer"
          className="px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
        >
          <option value="all">All Layers</option>
          {layers.map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <div className="flex gap-1 ml-auto">
          <button
            onClick={expandAll}
            className="px-3 py-2 rounded-lg text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)]"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-2 rounded-lg text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)]"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Implication Cards grouped by layer */}
      {grouped.map(group => (
        <div key={group.layer} className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Package className="w-5 h-5" style={{ color: 'var(--ff-accent)' }} aria-hidden="true" />
            {group.layer}
            <span className="text-sm font-normal text-[var(--ff-text-tertiary)]">
              ({group.items.length} trigger{group.items.length !== 1 ? 's' : ''})
            </span>
          </h3>

          {group.items.map(impl => {
            const isExpanded = expandedIds.has(impl.id);
            const hasGap = impl.triggerCondition.toLowerCase().includes('gap') ||
                           impl.triggerCondition.toLowerCase().includes('not imported');

            return (
              <div
                key={impl.id}
                className="rounded-lg border overflow-hidden"
                style={{
                  borderColor: hasGap ? 'var(--ff-warning)' : 'var(--ff-border-light)',
                  background: hasGap
                    ? 'color-mix(in srgb, var(--ff-warning) 5%, var(--ff-bg-secondary))'
                    : 'var(--ff-bg-secondary)',
                }}
              >
                {/* Header */}
                <button
                  onClick={() => toggleExpand(impl.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--ff-bg-primary)] transition-colors"
                  aria-expanded={isExpanded}
                  aria-controls={`impl-${impl.id}`}
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)] flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)] flex-shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-[var(--ff-text-primary)]">
                      {impl.trigger}
                      {hasGap && (
                        <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: 'color-mix(in srgb, var(--ff-warning) 15%, transparent)', color: 'var(--ff-warning)' }}>
                          <AlertTriangle className="w-3 h-3" /> Gap Blocker
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--ff-text-tertiary)] mt-0.5 truncate">
                      {impl.triggerCondition}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--ff-text-tertiary)] flex-shrink-0">
                    {impl.materials.length} material{impl.materials.length !== 1 ? 's' : ''}
                  </div>
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div id={`impl-${impl.id}`} className="border-t border-[var(--ff-border-light)]">
                    {/* QField Attributes Used */}
                    <div className="px-4 py-2 border-b border-[var(--ff-border-light)]">
                      <span className="text-xs text-[var(--ff-text-tertiary)] mr-2">QField attributes:</span>
                      {impl.qfieldAttributes.map(attr => (
                        <span
                          key={attr}
                          className="inline-block mr-1.5 mb-1 px-2 py-0.5 rounded text-xs font-mono border"
                          style={{
                            background: 'var(--ff-bg-primary)',
                            borderColor: 'var(--ff-border-light)',
                            color: 'var(--ff-text-secondary)',
                          }}
                        >
                          {attr}
                        </span>
                      ))}
                    </div>

                    {/* Materials Table */}
                    <table className="w-full" role="table" aria-label={`Materials for ${impl.trigger}`}>
                      <thead>
                        <tr className="text-xs text-[var(--ff-text-tertiary)]">
                          <th className="px-4 py-2 text-left font-medium">BOQ Category</th>
                          <th className="px-4 py-2 text-left font-medium">Material</th>
                          <th className="px-4 py-2 text-left font-medium">Formula</th>
                          <th className="px-4 py-2 text-left font-medium">UoM</th>
                          <th className="px-4 py-2 text-left font-medium">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {impl.materials.map((mat, idx) => {
                          const conf = CONFIDENCE_STYLES[mat.confidence];
                          return (
                            <tr
                              key={idx}
                              className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-primary)] transition-colors"
                            >
                              <td className="px-4 py-2 text-sm">
                                <span
                                  className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                                  style={{
                                    background: `color-mix(in srgb, ${CATEGORY_COLORS[mat.boqCategory] || 'var(--ff-text-tertiary)'} 15%, transparent)`,
                                    color: CATEGORY_COLORS[mat.boqCategory] || 'var(--ff-text-tertiary)',
                                  }}
                                >
                                  {mat.boqCategory}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-sm text-[var(--ff-text-primary)]">
                                {mat.item}
                                {mat.notes && (
                                  <div className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{mat.notes}</div>
                                )}
                              </td>
                              <td className="px-4 py-2 text-sm font-mono text-[var(--ff-text-secondary)]">
                                {mat.formula}
                              </td>
                              <td className="px-4 py-2 text-sm text-[var(--ff-text-tertiary)]">
                                {mat.uom}
                              </td>
                              <td className="px-4 py-2">
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={conf.style}
                                >
                                  {conf.icon}
                                  {conf.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Legend */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-3">Confidence Levels</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={CONFIDENCE_STYLES.exact.style}>
              {CONFIDENCE_STYLES.exact.icon} Exact
            </span>
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              Known 1:1 relationship. Can auto-deduct with high confidence.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={CONFIDENCE_STYLES.estimated.style}>
              {CONFIDENCE_STYLES.estimated.icon} Estimated
            </span>
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              Standard assumption based on typical install. Needs confirmation or adjustment.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={CONFIDENCE_STYLES.derived.style}>
              {CONFIDENCE_STYLES.derived.icon} Derived
            </span>
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              Calculated from another attribute (e.g. height, cable_capacity). Requires the source attribute to be imported first.
            </span>
          </div>
        </div>
      </div>

      {/* BOQ Category Distribution */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-3">Material Items by BOQ Category</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.byCategory)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, count]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--ff-border-light)]"
                style={{
                  background: `color-mix(in srgb, ${CATEGORY_COLORS[cat] || 'var(--ff-text-tertiary)'} 10%, transparent)`,
                  color: CATEGORY_COLORS[cat] || 'var(--ff-text-tertiary)',
                }}
              >
                {cat}
                <span className="text-xs opacity-75">({count})</span>
              </span>
            ))}
        </div>
      </div>
    </div>
  );
};
