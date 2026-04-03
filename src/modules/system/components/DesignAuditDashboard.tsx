'use client';

/**
 * Design System Audit Dashboard
 * Live inventory of all UI component patterns across FibreFlow
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Table2, Square, Loader2, Palette, Type, Eye,
  MousePointerClick, Bell, RefreshCw, AlertTriangle,
  CheckCircle2, XCircle, Minus, BarChart3, Layers,
  Plus, Download, Trash2, Edit3, Save, Search as SearchIcon,
  ChevronDown, Settings, ArrowRight, Filter, Upload
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

      {/* ═══════════════════════════════════════════════════════════
           COMPONENT GALLERY — Visual samples of every variant
           ═══════════════════════════════════════════════════════════ */}
      <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-6">
        <div className="flex items-center gap-2 mb-6">
          <Eye className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Component Gallery</h2>
          <span className="text-xs text-[var(--ff-text-tertiary)] ml-2">Live samples of every pattern found in the codebase</span>
        </div>

        {/* ── BUTTONS ─────────────────────────────────────────── */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4 border-b border-[var(--ff-border-light)] pb-2">
            Buttons — 4 Systems Coexisting
          </h3>

          <div className="mb-5">
            <p className="text-xs font-semibold text-red-400 mb-2">Pattern 1: Raw &lt;button&gt; with inline Tailwind (199 instances, ~90 unique styles)</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm">bg-blue-600</button>
              <button type="button" className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white transition-colors">bg-slate-700 sm</button>
              <button type="button" className="px-3 py-1.5 rounded text-xs font-semibold bg-green-700 hover:bg-green-600 text-white">bg-green-700</button>
              <button type="button" className="px-3 py-1.5 rounded text-xs font-semibold bg-red-700 hover:bg-red-600 text-white">bg-red-700</button>
              <button type="button" className="px-3 py-1.5 rounded text-xs font-semibold bg-amber-700 hover:bg-amber-600 text-white">bg-amber-700</button>
              <button type="button" className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700">shadow-sm variant</button>
              <button type="button" className="inline-flex items-center px-3 py-2 border border-gray-600 rounded-md text-sm font-medium text-gray-300 bg-transparent hover:bg-gray-700">bordered ghost</button>
              <button type="button" className="p-2 text-gray-400 hover:text-white rounded-md hover:bg-gray-700"><Settings className="w-4 h-4" /></button>
              <button type="button" className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"><Trash2 className="w-4 h-4" /></button>
              <button type="button" className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">text link style</button>
            </div>
          </div>

          <div className="mb-5">
            <p className="text-xs font-semibold text-blue-400 mb-2">Pattern 2: ff-button CSS classes (13 instances)</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ff-button ff-button--primary">ff-button primary</button>
              <button type="button" className="ff-button ff-button--secondary">ff-button secondary</button>
            </div>
          </div>

          <div className="mb-5">
            <p className="text-xs font-semibold text-green-400 mb-2">Pattern 3: CSS var themed (var(--ff-*) inline)</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="flex items-center justify-center px-4 py-2 bg-[var(--ff-primary-600)] text-white rounded-lg hover:bg-[var(--ff-primary-700)] transition-colors text-sm"><Plus className="w-4 h-4 mr-1.5" /> Primary action</button>
              <button type="button" className="flex items-center justify-center px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)] border border-[var(--ff-border-light)] text-sm"><Download className="w-4 h-4 mr-1.5" /> Secondary</button>
              <button type="button" className="flex items-center justify-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"><Trash2 className="w-4 h-4 mr-1.5" /> Danger</button>
              <button type="button" className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] p-2 rounded hover:bg-[var(--ff-bg-hover)]"><Edit3 className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="mt-4 p-4 rounded-lg border-2 border-dashed border-green-500/30 bg-green-500/5">
            <p className="text-xs font-semibold text-green-400 mb-3">TARGET: Unified Button component with consistent variants</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[var(--ff-primary-600)] text-white hover:bg-[var(--ff-primary-700)]"><Plus className="w-4 h-4" /> Primary</button>
              <button type="button" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]"><Download className="w-4 h-4" /> Secondary</button>
              <button type="button" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-red-600/10 text-red-400 border border-red-500/30 hover:bg-red-600/20"><Trash2 className="w-4 h-4" /> Danger</button>
              <button type="button" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]"><Settings className="w-4 h-4" /> Ghost</button>
              <button type="button" className="inline-flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]"><Edit3 className="w-4 h-4" /></button>
              <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors bg-[var(--ff-primary-600)] text-white hover:bg-[var(--ff-primary-700)]">Small</button>
            </div>
          </div>
        </div>

        {/* ── TABLES ──────────────────────────────────────────── */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4 border-b border-[var(--ff-border-light)] pb-2">
            Tables — 4 Systems
          </h3>
          <div className="mb-5">
            <p className="text-xs font-semibold text-red-400 mb-2">Pattern 1: Raw &lt;table&gt; with inline Tailwind (165 instances)</p>
            <div className="overflow-x-auto rounded border border-gray-700">
              <table className="min-w-full text-sm"><thead><tr className="bg-gray-800 text-gray-300 text-left text-xs uppercase"><th className="px-4 py-2">Name</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Value</th></tr></thead>
              <tbody className="divide-y divide-gray-700"><tr className="text-gray-300 hover:bg-gray-800"><td className="px-4 py-2">Item A</td><td className="px-4 py-2"><span className="text-green-400">Active</span></td><td className="px-4 py-2">R 1,200</td></tr><tr className="text-gray-300 hover:bg-gray-800"><td className="px-4 py-2">Item B</td><td className="px-4 py-2"><span className="text-yellow-400">Pending</span></td><td className="px-4 py-2">R 850</td></tr></tbody></table>
            </div>
          </div>
          <div className="mb-5">
            <p className="text-xs font-semibold text-blue-400 mb-2">Pattern 2: ff-table CSS classes (37 instances)</p>
            <div className="ff-table-container"><table className="ff-table"><thead><tr className="ff-table-header"><th className="ff-table-th">Name</th><th className="ff-table-th">Status</th><th className="ff-table-th">Value</th></tr></thead>
            <tbody><tr className="ff-table-row"><td className="ff-table-td ff-table-primary">Item A</td><td className="ff-table-td"><span className="text-green-400">Active</span></td><td className="ff-table-td">R 1,200</td></tr><tr className="ff-table-row"><td className="ff-table-td ff-table-primary">Item B</td><td className="ff-table-td"><span className="text-yellow-400">Pending</span></td><td className="ff-table-td">R 850</td></tr></tbody></table></div>
          </div>
          <div className="p-4 rounded-lg border-2 border-dashed border-green-500/30 bg-green-500/5">
            <p className="text-xs font-semibold text-green-400 mb-2">TARGET: Unified DataTable</p>
            <p className="text-xs text-[var(--ff-text-tertiary)] font-mono">{'<DataTable columns={cols} data={rows} searchable sortable paginated exportable />'}</p>
          </div>
        </div>

        {/* ── LOADING STATES ──────────────────────────────────── */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4 border-b border-[var(--ff-border-light)] pb-2">Loading States</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/5">
              <p className="text-xs font-semibold text-red-400 mb-3">DIY animate-spin (319 files)</p>
              <div className="flex items-center justify-center h-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>
            </div>
            <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
              <p className="text-xs font-semibold text-yellow-400 mb-3">DIY animate-pulse (65 files)</p>
              <div className="space-y-2 h-16 flex flex-col justify-center"><div className="h-3 bg-gray-700 rounded animate-pulse w-3/4" /><div className="h-3 bg-gray-700 rounded animate-pulse w-1/2" /><div className="h-3 bg-gray-700 rounded animate-pulse w-5/6" /></div>
            </div>
            <div className="p-4 rounded-lg border-2 border-dashed border-green-500/30 bg-green-500/5">
              <p className="text-xs font-semibold text-green-400 mb-3">TARGET</p>
              <div className="space-y-2 h-16 flex flex-col justify-center text-xs text-[var(--ff-text-tertiary)]"><p>{'<LoadingSpinner size="sm|md|lg" />'}</p><p>{'<SkeletonTable rows={5} cols={3} />'}</p></div>
            </div>
          </div>
        </div>

        {/* ── MODALS ──────────────────────────────────────────── */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4 border-b border-[var(--ff-border-light)] pb-2">Modals</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/5">
              <p className="text-xs font-semibold text-red-400 mb-3">DIY fixed inset-0 (107)</p>
              <div className="relative h-28 rounded bg-[var(--ff-bg-tertiary)] overflow-hidden"><div className="absolute inset-0 bg-black/50 flex items-center justify-center"><div className="bg-gray-800 rounded-lg p-3 w-3/4 shadow-xl border border-gray-700"><p className="text-xs text-white mb-2">Custom modal</p><div className="flex gap-1 justify-end"><button type="button" className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded">Cancel</button><button type="button" className="px-2 py-1 text-xs bg-blue-600 text-white rounded">Save</button></div></div></div></div>
            </div>
            <div className="p-4 rounded-lg border border-orange-500/30 bg-orange-500/5">
              <p className="text-xs font-semibold text-orange-400 mb-3">window.confirm() (24)</p>
              <div className="h-28 flex items-center justify-center"><div className="bg-white rounded p-3 text-black text-xs shadow-lg border w-3/4"><p className="font-semibold mb-1">localhost says</p><p className="mb-2">Delete this item?</p><div className="flex gap-2 justify-end"><button type="button" className="px-2 py-1 text-xs bg-gray-200 rounded">Cancel</button><button type="button" className="px-2 py-1 text-xs bg-blue-500 text-white rounded">OK</button></div></div></div>
            </div>
            <div className="p-4 rounded-lg border-2 border-dashed border-green-500/30 bg-green-500/5">
              <p className="text-xs font-semibold text-green-400 mb-3">TARGET: ConfirmDialog</p>
              <div className="relative h-28 rounded bg-[var(--ff-bg-tertiary)] overflow-hidden"><div className="absolute inset-0 bg-black/50 flex items-center justify-center"><div className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 w-3/4 shadow-xl border border-[var(--ff-border-light)]"><p className="text-xs text-[var(--ff-text-primary)] font-semibold mb-1">Delete Item?</p><p className="text-xs text-[var(--ff-text-tertiary)] mb-2">This cannot be undone.</p><div className="flex gap-1 justify-end"><button type="button" className="px-2 py-1 text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded border border-[var(--ff-border-light)]">Cancel</button><button type="button" className="px-2 py-1 text-xs bg-red-600 text-white rounded">Delete</button></div></div></div></div>
            </div>
          </div>
        </div>

        {/* ── BADGES ──────────────────────────────────────────── */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4 border-b border-[var(--ff-border-light)] pb-2">Status Badges</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-red-400 mb-2">Current: ~20 different styles</p>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400">Active</span>
                <span className="px-2 py-0.5 text-xs rounded bg-green-900 text-green-300">Active v2</span>
                <span className="px-2 py-1 text-xs font-semibold bg-green-600 text-white rounded-md">ACTIVE</span>
                <span className="inline-block w-3 h-3 rounded-full bg-green-500" />
                <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">Pending</span>
                <span className="px-2 py-0.5 text-xs rounded bg-red-900 text-red-300">Rejected</span>
                <span className="px-3 py-1 text-xs bg-blue-600 text-white rounded-full">In Progress</span>
                <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-400">Draft</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-green-400 mb-2">TARGET: Unified StatusBadge</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Active', color: 'green' },
                  { label: 'Pending', color: 'yellow' },
                  { label: 'Failed', color: 'red' },
                  { label: 'In Progress', color: 'blue' },
                  { label: 'Draft', color: 'gray' },
                ].map((b) => (
                  <span key={b.label} className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full bg-${b.color}-500/15 text-${b.color}-400 border border-${b.color}-500/30`}>
                    <span className={`w-1.5 h-1.5 rounded-full bg-${b.color}-400`} /> {b.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── CARDS ────────────────────────────────────────────── */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4 border-b border-[var(--ff-border-light)] pb-2">Cards</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><p className="text-xs font-semibold text-red-400 mb-2">Hardcoded Tailwind</p><div className="bg-gray-800 rounded-lg border border-gray-700 p-4"><h4 className="text-white font-semibold text-sm">Project Alpha</h4><p className="text-gray-400 text-xs mt-1">Drops: 450</p><div className="mt-2 flex justify-between text-xs"><span className="text-gray-500">Active</span><span className="text-green-400">87%</span></div></div></div>
            <div><p className="text-xs font-semibold text-blue-400 mb-2">ff-card CSS</p><div className="ff-card"><div className="ff-card-header"><h4 className="ff-card-title">Project Alpha</h4><p className="ff-card-subtitle">Drops: 450</p></div><div className="ff-card-content"><div className="flex justify-between text-xs"><span className="text-[var(--ff-text-tertiary)]">Active</span><span className="text-green-400">87%</span></div></div></div></div>
            <div><p className="text-xs font-semibold text-green-400 mb-2">CSS var themed (target)</p><div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4"><h4 className="text-[var(--ff-text-primary)] font-semibold text-sm">Project Alpha</h4><p className="text-[var(--ff-text-tertiary)] text-xs mt-1">Drops: 450</p><div className="mt-2 flex justify-between text-xs"><span className="text-[var(--ff-text-tertiary)]">Active</span><span className="text-green-400">87%</span></div></div></div>
          </div>
        </div>

        {/* ── INPUTS ──────────────────────────────────────────── */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4 border-b border-[var(--ff-border-light)] pb-2">Form Inputs</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><p className="text-xs font-semibold text-red-400 mb-2">Raw (hardcoded)</p><input type="text" placeholder="bg-gray-800 border-gray-600..." className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500" readOnly /></div>
            <div><p className="text-xs font-semibold text-blue-400 mb-2">ff-input CSS</p><input type="text" placeholder="ff-input class..." className="ff-input w-full" readOnly /></div>
            <div><p className="text-xs font-semibold text-green-400 mb-2">CSS var (target)</p><input type="text" placeholder="Search..." className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]" readOnly /></div>
          </div>
        </div>

        {/* ── COLORS ──────────────────────────────────────────── */}
        <div>
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4 border-b border-[var(--ff-border-light)] pb-2">Color System</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-red-400 mb-2">Hardcoded Tailwind (6,971 uses)</p>
              <div className="flex gap-1 flex-wrap">
                {['bg-blue-500', 'bg-blue-600', 'bg-red-500', 'bg-green-500', 'bg-gray-700', 'bg-gray-800', 'bg-slate-800', 'bg-amber-500'].map((c) => (
                  <div key={c} className={`${c} w-10 h-10 rounded flex items-center justify-center`}><span className="text-[6px] text-white/80 font-mono">{c.replace('bg-', '')}</span></div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-green-400 mb-2">CSS Variables (9,037 uses)</p>
              <div className="flex gap-1 flex-wrap">
                {[
                  { n: 'primary', c: 'bg-[var(--ff-primary-500)]' },
                  { n: 'bg-pri', c: 'bg-[var(--ff-bg-primary)]' },
                  { n: 'bg-sec', c: 'bg-[var(--ff-bg-secondary)]' },
                  { n: 'bg-ter', c: 'bg-[var(--ff-bg-tertiary)]' },
                  { n: 'hover', c: 'bg-[var(--ff-bg-hover)]' },
                ].map((v) => (
                  <div key={v.n} className={`${v.c} w-10 h-10 rounded border border-[var(--ff-border-light)] flex items-center justify-center`}><span className="text-[6px] text-white/80 font-mono">{v.n}</span></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
