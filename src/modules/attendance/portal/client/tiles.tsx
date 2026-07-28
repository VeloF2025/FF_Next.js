/**
 * /my hub tiles — presentational tile components for the MyHub grid.
 *
 * Extracted from MyHub.tsx to keep that file focused on data loading and
 * layout orchestration. Each tile is a thin wrapper around the shared
 * <Tile> primitive defined at the bottom of this file.
 */

import React from 'react';
import {
  Clock as ClockIcon,
  Car,
  FileText,
  Receipt,
  AlertCircle,
  Package,
  Camera,
  ShieldCheck,
  Users,
} from 'lucide-react';

import type { HubSummaryResponse } from './api';

type HubSummary = HubSummaryResponse;

export function ClockTile({ summary, onClick }: { summary: HubSummary | null; onClick: () => void }) {
  const open = summary?.openEntry;
  const sinceLabel = open ? formatTimeSAST(open.clockInAt) : null;

  return (
    <Tile
      onClick={onClick}
      icon={<ClockIcon className="w-5 h-5" />}
      iconClass={open ? 'bg-emerald-500/15 text-emerald-300' : 'bg-blue-500/15 text-blue-300'}
      title="Clock"
      subtitle={
        summary === null
          ? 'Loading…'
          : open
            ? `On shift since ${sinceLabel}`
            : 'Tap to clock in'
      }
      badge={open ? 'On shift' : null}
      badgeClass="bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    />
  );
}

export function VehicleTile({
  summary,
  hasVehicle,
  pending,
  onClick,
}: {
  summary: HubSummary | null;
  hasVehicle: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  // PRD §4.2 + FR-HUB-01: office staff with no vehicle should NOT
  // see the vehicle tile at all (was rendering as a disabled placeholder).
  if (!hasVehicle) return null;

  const reg = summary?.assignedVehicle?.registration ?? '…';
  return (
    <Tile
      onClick={onClick}
      icon={<Car className="w-5 h-5" />}
      iconClass="bg-emerald-500/15 text-emerald-300"
      title="My Vehicle"
      subtitle={pending ? 'Opening…' : reg}
      disabled={pending}
    />
  );
}

export function PayslipsTile({
  summary,
  onClick,
}: {
  summary: HubSummary | null;
  onClick: () => void;
}) {
  // PRD §7.1 FR-HUB-01: "Payslips (if any)" — hide when summary has
  // loaded with no payslips. While loading we still render a
  // placeholder so the slot doesn't pop in suddenly.
  const latest = summary?.latestPayslip;
  if (summary === null) {
    return (
      <Tile
        onClick={onClick}
        icon={<FileText className="w-5 h-5" />}
        iconClass="bg-neutral-800 text-neutral-500"
        title="Payslips"
        subtitle="Loading…"
      />
    );
  }
  if (!latest) return null;
  return (
    <Tile
      onClick={onClick}
      icon={<FileText className="w-5 h-5" />}
      iconClass="bg-blue-500/15 text-blue-300"
      title="Payslips"
      subtitle={`Latest: ${formatPayslipPeriod(latest.payPeriodStart, latest.payPeriodEnd)}`}
    />
  );
}

function formatPayslipPeriod(start: string, end: string): string {
  const startMonth = payslipMonth(start);
  const endMonth = payslipMonth(end);
  return startMonth === endMonth ? startMonth : `${startMonth} – ${endMonth}`;
}

function payslipMonth(iso: string): string {
  const [year, month] = iso.split('-');
  const monthIdx = Number(month) - 1;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[monthIdx] ?? month} ${year}`;
}

export function ReceiptsTile({
  summary,
  onClick,
}: {
  summary: HubSummary | null;
  onClick: () => void;
}) {
  const latest = summary?.latestReceipt;
  if (!latest) {
    return (
      <Tile
        onClick={onClick}
        icon={<Receipt className="w-5 h-5" />}
        iconClass="bg-neutral-800 text-neutral-500"
        title="Receipts"
        subtitle={summary === null ? 'Loading…' : 'Capture your first slip'}
      />
    );
  }
  const subtitle = latest.vendor
    ? `${latest.vendor} · ${formatRand(latest.totalCents)}`
    : `Latest · ${formatRand(latest.totalCents)}`;
  return (
    <Tile
      onClick={onClick}
      icon={<Receipt className="w-5 h-5" />}
      iconClass="bg-emerald-500/15 text-emerald-300"
      title="Receipts"
      subtitle={subtitle}
    />
  );
}

function formatRand(cents: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function CorrectionsTile({
  summary,
  onClick,
}: {
  summary: HubSummary | null;
  onClick: () => void;
}) {
  const pending = summary?.pendingCorrectionsCount ?? 0;
  return (
    <Tile
      onClick={onClick}
      icon={<AlertCircle className="w-5 h-5" />}
      iconClass="bg-blue-500/15 text-blue-300"
      title="Corrections"
      subtitle={
        summary === null
          ? 'Loading…'
          : pending === 0
            ? 'No pending'
            : `${pending} pending`
      }
      badge={pending > 0 ? String(pending) : null}
      badgeClass="bg-blue-600 text-white border-blue-500"
    />
  );
}

export function StoresTile({ onClick }: { onClick: () => void }) {
  return (
    <Tile
      onClick={onClick}
      icon={<Package className="w-5 h-5" />}
      iconClass="bg-amber-500/15 text-amber-300"
      title="Stores"
      subtitle="Issue &amp; return field stock"
    />
  );
}

export function SiteCamTile({ onClick }: { onClick: () => void }) {
  return (
    <Tile
      onClick={onClick}
      icon={<Camera className="w-5 h-5" />}
      iconClass="bg-sky-500/15 text-sky-300"
      title="SiteCam"
      subtitle="Capture installation photos"
    />
  );
}

/**
 * Daily H&S check-in. Deliberately the loudest tile when outstanding: the
 * whole feature depends on people doing it, and a quiet "not done" reads as
 * optional. A blocked check-in stays visible until an H&S officer clears it,
 * because the worker cannot resolve it themselves.
 */
export function HsCheckinTile({
  status,
  onClick,
}: {
  status: { completed: boolean; clearance: string | null } | null;
  onClick: () => void;
}) {
  const blocked = status?.clearance === 'blocked';
  const done = status?.completed === true;

  return (
    <Tile
      onClick={onClick}
      icon={<ShieldCheck className="w-5 h-5" />}
      iconClass={
        blocked
          ? 'bg-red-500/15 text-red-300'
          : done
            ? 'bg-emerald-500/15 text-emerald-300'
            : 'bg-orange-500/15 text-orange-300'
      }
      title="H&amp;S check-in"
      subtitle={
        status === null
          ? 'Loading…'
          : blocked
            ? 'Blocked — an H&S officer must clear you'
            : done
              ? 'Done for today'
              : 'Not done today — tap to complete'
      }
      badge={status === null ? null : blocked ? 'Blocked' : done ? null : 'Due'}
      badgeClass={
        blocked
          ? 'bg-red-500/15 text-red-300 border-red-500/30'
          : 'bg-orange-500/15 text-orange-300 border-orange-500/30'
      }
    />
  );
}

/**
 * Crew H&S check-in — supervisors/admins only (MyHub gates on profile.role;
 * the API enforces the same gate server-side). `recordedToday` is null while
 * loading OR when the status fetch failed: the tile still renders and the
 * page itself will explain any problem — fail-open, like the hub itself.
 */
export function HsCrewCheckinTile({
  recordedToday,
  onClick,
}: {
  recordedToday: number | null;
  onClick: () => void;
}) {
  return (
    <Tile
      onClick={onClick}
      icon={<Users className="w-5 h-5" />}
      iconClass="bg-orange-500/15 text-orange-300"
      title="Crew check-in"
      subtitle={
        recordedToday != null && recordedToday > 0
          ? `${recordedToday} recorded today`
          : 'Record your crew’s H&S declaration'
      }
      badge={recordedToday != null && recordedToday > 0 ? String(recordedToday) : null}
      badgeClass="bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    />
  );
}

interface TileProps {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  subtitle: string;
  badge?: string | null;
  badgeClass?: string;
  onClick?: () => void;
  disabled?: boolean;
}

function Tile({
  icon,
  iconClass,
  title,
  subtitle,
  badge,
  badgeClass = '',
  onClick,
  disabled = false,
}: TileProps) {
  const baseClass =
    'rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-left transition-colors min-h-[110px] flex flex-col gap-2';
  const interactiveClass = disabled
    ? 'opacity-60 cursor-not-allowed'
    : 'hover:bg-neutral-800/80 active:bg-neutral-800';

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`${baseClass} ${interactiveClass}`}
    >
      <div className="flex items-center justify-between">
        <span className={`flex w-10 h-10 items-center justify-center rounded-xl ${iconClass}`}>
          {icon}
        </span>
        {badge && (
          <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-neutral-100">{title}</div>
        <div className="text-xs text-neutral-400 mt-0.5">{subtitle}</div>
      </div>
    </button>
  );
}

function formatTimeSAST(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Johannesburg',
  }).format(d);
}
