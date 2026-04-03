'use client';

/**
 * Design System Audit Dashboard
 * Live inventory of all UI component patterns across FibreFlow
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Table2, Square, Loader2, Palette, Type,
  MousePointerClick, Bell, RefreshCw, AlertTriangle,
  CheckCircle2, XCircle, Minus, BarChart3, Layers
} from 'lucide-react';
import { log } from '@/lib/logger';

// ── Types ──────────────────────────────────────────────────────
interface AuditData {
  timestamp: string;
  buttons: { rawButton: number; ffButtonClass: number; buttonComponent: number; velocityButton: number; topPatterns: Array<{ pattern: string; count: number }> };
  tables: { rawTable: number; standardDataTable: number; ffTableClass: number; muiDataGrid: number };
  modals: { diyOverlays: number; confirmDialog: number; windowConfirm: number };
  cards: { ffCardClass: number; glassCard: number; adHocCards: number };
  loading: { diySpinner: number; loadingSpinner: number; diySkeleton: number; velocitySpinner: number };
  inputs: { rawInput: number; ffInputClass: number; muiTextField: number; velocityInput: number };
  colors: { cssVarUsage: number; hardcodedTailwind: number; darkPrefix: number };
  icons: { lucide: number; muiIcons: number; inlineSvg: number };
  navigation: { moduleNav: number; roleTabs: number };
  toasts: { directToast: number; notificationService: number };
  sharedComponents: Record<string, number>;
}

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'healthy';

// ── Severity helpers ───────────────────────────────────────────
function getSeverityColor(s: Severity): string {
  const map: Record<Severity, string> = {
    critical: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-blue-400',
    healthy: 'text-green-400',
  };
  return map[s];
}

function getSeverityBg(s: Severity): string {
  const map: Record<Severity, string> = {
    critical: 'bg-red-500/10 border-red-500/30',
    high: 'bg-orange-500/10 border-orange-500/30',
    medium: 'bg-yellow-500/10 border-yellow-500/30',
    low: 'bg-blue-500/10 border-blue-500/30',
    healthy: 'bg-green-500/10 border-green-500/30',
  };
  return map[s];
}

function getSeverityIcon(s: Severity) {
  if (s === 'critical' || s === 'high') return <XCircle className={`w-5 h-5 ${getSeverityColor(s)}`} />;
  if (s === 'medium') return <AlertTriangle className={`w-5 h-5 ${getSeverityColor(s)}`} />;
  if (s === 'low') return <Minus className={`w-5 h-5 ${getSeverityColor(s)}`} />;
  return <CheckCircle2 className={`w-5 h-5 ${getSeverityColor(s)}`} />;
}

// ── Bar chart ──────────────────────────────────────────────────
function Bar({ label, value, max, color = 'bg-blue-500' }: { label: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 text-[var(--ff-text-secondary)] truncate">{label}</span>
      <div className="flex-1 h-5 bg-[var(--ff-bg-tertiary)] rounded overflow-hidden">
        <div className={`h-full ${color} rounded transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right font-mono text-[var(--ff-text-primary)]">{value.toLocaleString()}</span>
    </div>
  );
}

// ── Adoption gauge ─────────────────────────────────────────────
function AdoptionGauge({ adopted, total, label }: { adopted: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((adopted / total) * 100) : 0;
  const severity: Severity = pct >= 80 ? 'healthy' : pct >= 50 ? 'medium' : pct >= 20 ? 'high' : 'critical';
  return (
    <div className={`rounded-lg border p-4 ${getSeverityBg(severity)}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-[var(--ff-text-secondary)]">{label}</span>
        {getSeverityIcon(severity)}
      </div>
      <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{pct}%</div>
      <div className="text-xs text-[var(--ff-text-tertiary)] mt-1">
        {adopted} shared / {total} total
      </div>
      <div className="h-1.5 bg-[var(--ff-bg-tertiary)] rounded mt-2 overflow-hidden">
        <div
          className={`h-full rounded ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : pct >= 20 ? 'bg-orange-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Section card ───────────────────────────────────────────────
function Section({
  title, icon, severity, children,
}: { title: string; icon: React.ReactNode; severity: Severity; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-5 ${getSeverityBg(severity)}`}>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{title}</h3>
        <span className={`ml-auto text-xs font-semibold uppercase ${getSeverityColor(severity)}`}>
          {severity}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Roadmap item ───────────────────────────────────────────────
interface RoadmapItem {
  phase: number;
  name: string;
  effort: string;
  impact: number;
  status: 'not-started' | 'in-progress' | 'done';
  description: string;
}

const ROADMAP: RoadmapItem[] = [
  { phase: 0, name: 'ESLint enforcement rules', effort: '1 day', impact: 0, status: 'not-started', description: 'Ban animate-spin, dark:, fixed inset-0 — prevent new debt' },
  { phase: 1, name: 'Spinner standardization', effort: '1-2 days', impact: 316, status: 'not-started', description: 'Enforce LoadingSpinner, delete VelocitySpinner' },
  { phase: 1, name: 'Badge component', effort: '2 days', impact: 55, status: 'not-started', description: 'Adopt existing Badge.tsx across all status displays' },
  { phase: 1, name: 'Skeleton component', effort: '1 day', impact: 64, status: 'not-started', description: 'Create shared SkeletonTable/SkeletonCard, replace animate-pulse' },
  { phase: 1, name: 'Tabs component', effort: '1 day', impact: 34, status: 'not-started', description: 'Radix Tabs wrapper over ff-tab CSS classes' },
  { phase: 2, name: 'Button consolidation', effort: '3-5 days', impact: 198, status: 'not-started', description: 'Consolidate button.tsx + VelocityButton + ff-button → one system' },
  { phase: 2, name: 'TextInput component', effort: '3 days', impact: 30, status: 'not-started', description: 'Consolidate VelocityInput + MUI TextField + raw input' },
  { phase: 2, name: 'SearchFilter adoption', effort: '1 week', impact: 40, status: 'not-started', description: 'Wire StandardSearchFilter into all list pages' },
  { phase: 3, name: 'Card component', effort: '3-5 days', impact: 464, status: 'not-started', description: 'Unify GlassCard + ff-card + ad-hoc cards' },
  { phase: 3, name: 'DataTable component', effort: '2-3 weeks', impact: 164, status: 'not-started', description: 'Enforce StandardDataTable with sort/pagination/export' },
  { phase: 4, name: 'Modal/Sheet component', effort: '1-2 weeks', impact: 105, status: 'not-started', description: 'Radix Dialog wrapper, replace 105 DIY overlays' },
  { phase: 5, name: 'Theme debt cleanup', effort: 'Ongoing', impact: 6971, status: 'not-started', description: 'Replace hardcoded Tailwind colors + dark: prefixes with CSS vars' },
];

// ── Main component ─────────────────────────────────────────────
export default function DesignAuditDashboard() {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/system/design-audit');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.message || 'Audit scan failed');
      }
    } catch (err) {
      log.error('Failed to fetch design audit', { error: err });
      setError('Failed to connect to audit endpoint');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">Scanning codebase...</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">This may take 10-15 seconds</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <XCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <p className="text-[var(--ff-text-primary)]">{error || 'No data'}</p>
          <button onClick={fetchAudit} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Compute adoption metrics
  const buttonTotal = data.buttons.rawButton + data.buttons.buttonComponent + data.buttons.velocityButton + data.buttons.ffButtonClass;
  const buttonAdopted = data.buttons.buttonComponent + data.buttons.velocityButton + data.buttons.ffButtonClass;
  const tableTotal = data.tables.rawTable + data.tables.standardDataTable + data.tables.muiDataGrid;
  const tableAdopted = data.tables.standardDataTable;
  const modalTotal = data.modals.diyOverlays + data.modals.confirmDialog;
  const modalAdopted = data.modals.confirmDialog;
  const loadingTotal = data.loading.diySpinner + data.loading.loadingSpinner;
  const loadingAdopted = data.loading.loadingSpinner;
  const colorTotal = data.colors.cssVarUsage + data.colors.hardcodedTailwind;
  const colorAdopted = data.colors.cssVarUsage;
  const toastTotal = data.toasts.directToast + data.toasts.notificationService;
  const toastAdopted = data.toasts.notificationService;

  // Overall score
  const scores = [
    buttonAdopted / Math.max(buttonTotal, 1),
    tableAdopted / Math.max(tableTotal, 1),
    modalAdopted / Math.max(modalTotal, 1),
    loadingAdopted / Math.max(loadingTotal, 1),
    colorAdopted / Math.max(colorTotal, 1),
    toastAdopted / Math.max(toastTotal, 1),
  ];
  const overallPct = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Design System Audit</h1>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            Live scan of component patterns across {data.buttons.rawButton + data.buttons.buttonComponent}+ files
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--ff-text-tertiary)]">
            {new Date(data.timestamp).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}
          </span>
          <button
            onClick={fetchAudit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] border border-[var(--ff-border-light)]"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Rescan
          </button>
        </div>
      </div>

      {/* Overall score */}
      <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-6">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className={`text-5xl font-bold ${overallPct >= 60 ? 'text-green-400' : overallPct >= 30 ? 'text-yellow-400' : 'text-red-400'}`}>
              {overallPct}%
            </div>
            <div className="text-xs text-[var(--ff-text-tertiary)] mt-1">Design System Adoption</div>
          </div>
          <div className="flex-1 grid grid-cols-3 md:grid-cols-6 gap-3">
            <AdoptionGauge adopted={buttonAdopted} total={buttonTotal} label="Buttons" />
            <AdoptionGauge adopted={tableAdopted} total={tableTotal} label="Tables" />
            <AdoptionGauge adopted={modalAdopted} total={modalTotal} label="Modals" />
            <AdoptionGauge adopted={loadingAdopted} total={loadingTotal} label="Loading" />
            <AdoptionGauge adopted={colorAdopted} total={colorTotal} label="Colors" />
            <AdoptionGauge adopted={toastAdopted} total={toastTotal} label="Toasts" />
          </div>
        </div>
      </div>

      {/* Detail sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Buttons */}
        <Section
          title="Buttons"
          icon={<MousePointerClick className="w-5 h-5 text-[var(--ff-text-secondary)]" />}
          severity={buttonAdopted / Math.max(buttonTotal, 1) > 0.5 ? 'medium' : 'critical'}
        >
          <div className="space-y-2">
            <Bar label="Raw <button>" value={data.buttons.rawButton} max={buttonTotal} color="bg-red-500" />
            <Bar label="button.tsx (CVA)" value={data.buttons.buttonComponent} max={buttonTotal} color="bg-green-500" />
            <Bar label="VelocityButton" value={data.buttons.velocityButton} max={buttonTotal} color="bg-yellow-500" />
            <Bar label="ff-button CSS" value={data.buttons.ffButtonClass} max={buttonTotal} color="bg-blue-500" />
          </div>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
            3 button systems coexist. ~90 unique className strings on raw buttons.
          </p>
        </Section>

        {/* Tables */}
        <Section
          title="Tables"
          icon={<Table2 className="w-5 h-5 text-[var(--ff-text-secondary)]" />}
          severity={tableAdopted / Math.max(tableTotal, 1) > 0.2 ? 'high' : 'critical'}
        >
          <div className="space-y-2">
            <Bar label="Raw <table>" value={data.tables.rawTable} max={tableTotal} color="bg-red-500" />
            <Bar label="StandardDataTable" value={data.tables.standardDataTable} max={tableTotal} color="bg-green-500" />
            <Bar label="ff-table CSS" value={data.tables.ffTableClass} max={tableTotal} color="bg-blue-500" />
            <Bar label="MUI DataGrid" value={data.tables.muiDataGrid} max={tableTotal} color="bg-yellow-500" />
          </div>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
            StandardDataTable exists but has near-zero adoption. Sort/pagination reimplemented everywhere.
          </p>
        </Section>

        {/* Modals */}
        <Section
          title="Modals & Dialogs"
          icon={<Square className="w-5 h-5 text-[var(--ff-text-secondary)]" />}
          severity={data.modals.diyOverlays > 50 ? 'critical' : 'high'}
        >
          <div className="space-y-2">
            <Bar label="DIY fixed inset-0" value={data.modals.diyOverlays} max={modalTotal} color="bg-red-500" />
            <Bar label="ConfirmDialog" value={data.modals.confirmDialog} max={modalTotal} color="bg-green-500" />
            <Bar label="window.confirm()" value={data.modals.windowConfirm} max={Math.max(data.modals.windowConfirm, modalTotal)} color="bg-orange-500" />
          </div>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
            No shared Modal/Sheet component. Every module builds its own overlay.
          </p>
        </Section>

        {/* Loading */}
        <Section
          title="Loading States"
          icon={<Loader2 className="w-5 h-5 text-[var(--ff-text-secondary)]" />}
          severity={data.loading.diySpinner > 100 ? 'critical' : 'high'}
        >
          <div className="space-y-2">
            <Bar label="DIY animate-spin" value={data.loading.diySpinner} max={loadingTotal} color="bg-red-500" />
            <Bar label="LoadingSpinner" value={data.loading.loadingSpinner} max={loadingTotal} color="bg-green-500" />
            <Bar label="DIY animate-pulse" value={data.loading.diySkeleton} max={Math.max(data.loading.diySkeleton, loadingTotal)} color="bg-yellow-500" />
            <Bar label="VelocitySpinner" value={data.loading.velocitySpinner} max={loadingTotal} color="bg-purple-500" />
          </div>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
            LoadingSpinner exists but {data.loading.diySpinner} files roll their own. VelocitySpinner has 0 adoption.
          </p>
        </Section>

        {/* Colors */}
        <Section
          title="Theme Consistency"
          icon={<Palette className="w-5 h-5 text-[var(--ff-text-secondary)]" />}
          severity={data.colors.hardcodedTailwind > data.colors.cssVarUsage ? 'critical' : data.colors.hardcodedTailwind > 3000 ? 'high' : 'medium'}
        >
          <div className="space-y-2">
            <Bar label="var(--ff-*) correct" value={data.colors.cssVarUsage} max={colorTotal} color="bg-green-500" />
            <Bar label="Hardcoded Tailwind" value={data.colors.hardcodedTailwind} max={colorTotal} color="bg-red-500" />
            <Bar label="dark: prefix" value={data.colors.darkPrefix} max={colorTotal} color="bg-orange-500" />
          </div>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
            Two theme systems in conflict: CSS variables (correct) vs hardcoded Tailwind colors + dark: prefix.
          </p>
        </Section>

        {/* Icons */}
        <Section
          title="Icons"
          icon={<Type className="w-5 h-5 text-[var(--ff-text-secondary)]" />}
          severity="healthy"
        >
          <div className="space-y-2">
            <Bar label="Lucide React" value={data.icons.lucide} max={data.icons.lucide} color="bg-green-500" />
            <Bar label="Inline SVG" value={data.icons.inlineSvg} max={data.icons.lucide} color="bg-yellow-500" />
            <Bar label="MUI Icons" value={data.icons.muiIcons} max={data.icons.lucide} color="bg-red-500" />
          </div>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
            Lucide is the universal standard. No fragmentation.
          </p>
        </Section>

        {/* Toasts */}
        <Section
          title="Notifications"
          icon={<Bell className="w-5 h-5 text-[var(--ff-text-secondary)]" />}
          severity={data.toasts.directToast > data.toasts.notificationService ? 'high' : 'medium'}
        >
          <div className="space-y-2">
            <Bar label="Direct react-hot-toast" value={data.toasts.directToast} max={toastTotal} color="bg-red-500" />
            <Bar label="NotificationService" value={data.toasts.notificationService} max={toastTotal} color="bg-green-500" />
          </div>
        </Section>

        {/* Shared Components */}
        <Section
          title="Shared Component Adoption"
          icon={<Layers className="w-5 h-5 text-[var(--ff-text-secondary)]" />}
          severity="high"
        >
          <div className="space-y-2">
            {Object.entries(data.sharedComponents).map(([name, count]) => (
              <Bar
                key={name}
                label={name.replace(/([A-Z])/g, ' $1').trim()}
                value={count}
                max={30}
                color={count > 5 ? 'bg-green-500' : count > 0 ? 'bg-yellow-500' : 'bg-red-500'}
              />
            ))}
          </div>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
            Standard* family was built but never enforced. Most have 0-1 adopters.
          </p>
        </Section>
      </div>

      {/* Roadmap */}
      <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-6">
        <div className="flex items-center gap-2 mb-5">
          <BarChart3 className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Component Roadmap</h2>
        </div>

        <div className="space-y-1">
          <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-[var(--ff-text-tertiary)] uppercase pb-2 border-b border-[var(--ff-border-light)]">
            <div className="col-span-1">Phase</div>
            <div className="col-span-3">Component</div>
            <div className="col-span-1">Effort</div>
            <div className="col-span-1 text-right">Impact</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-5">Description</div>
          </div>

          {ROADMAP.map((item, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-2 text-sm py-2 border-b border-[var(--ff-border-light)] last:border-0 items-center"
            >
              <div className="col-span-1">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--ff-bg-tertiary)] text-xs font-bold text-[var(--ff-text-secondary)]">
                  {item.phase}
                </span>
              </div>
              <div className="col-span-3 font-medium text-[var(--ff-text-primary)]">{item.name}</div>
              <div className="col-span-1 text-[var(--ff-text-tertiary)]">{item.effort}</div>
              <div className="col-span-1 text-right font-mono text-[var(--ff-text-secondary)]">
                {item.impact > 0 ? `${item.impact}` : '—'}
              </div>
              <div className="col-span-1">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                    item.status === 'done'
                      ? 'bg-green-500/20 text-green-400'
                      : item.status === 'in-progress'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'
                  }`}
                >
                  {item.status === 'done' ? 'Done' : item.status === 'in-progress' ? 'WIP' : 'Planned'}
                </span>
              </div>
              <div className="col-span-5 text-[var(--ff-text-tertiary)]">{item.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
