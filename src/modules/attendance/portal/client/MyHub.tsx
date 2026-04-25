/**
 * /my hub — tile grid landing for signed-in staff.
 *
 * Phase 1 / PR 2 of PRD-040. Tiles render with badges from the
 * /api/my/hub-summary aggregator endpoint:
 *
 *   - Clock — always shown. "On shift since HH:mm" if open entry, else "Tap to clock in".
 *   - My Vehicle — shown only if the staff has an active vehicle assignment.
 *     Currently disabled (Phase 2 wires the SSO bridge to /fleet/portal).
 *   - Payslips — Phase 3 placeholder.
 *   - Corrections — always shown, badged with pending count.
 *   - History — always shown, full-width, badged with last 14 days entry count.
 */

import React from 'react';
import { useRouter } from 'next/router';
import {
  Clock as ClockIcon,
  Car,
  FileText,
  History as HistoryIcon,
  AlertCircle,
} from 'lucide-react';

import { getHubSummary, requestFleetHandoff } from './api';
import type { AttendanceProfile, HubSummaryResponse } from './api';
import { MyPortalShell } from './MyPortalShell';
import { InstallPrompt } from './InstallPrompt';

type HubSummary = HubSummaryResponse;

interface MyHubProps {
  profile: AttendanceProfile;
}

export function MyHub({ profile }: MyHubProps) {
  const router = useRouter();
  const [summary, setSummary] = React.useState<HubSummary | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [vehicleHandoffPending, setVehicleHandoffPending] = React.useState(false);
  const [vehicleHandoffError, setVehicleHandoffError] = React.useState<string | null>(null);

  const handleVehicleTap = React.useCallback(async () => {
    if (vehicleHandoffPending) return;
    setVehicleHandoffPending(true);
    setVehicleHandoffError(null);
    try {
      await requestFleetHandoff();
      // Hard nav: the new ff_portal_session cookie is httpOnly so the
      // /fleet/portal page can only see it after a real navigation,
      // not a client-side router.push (Next.js may keep the previous
      // request context alive).
      window.location.assign('/fleet/portal?from=my');
    } catch (err) {
      setVehicleHandoffPending(false);
      setVehicleHandoffError(
        err instanceof Error ? err.message : 'Could not open the vehicle portal'
      );
    }
  }, [vehicleHandoffPending]);

  React.useEffect(() => {
    let cancelled = false;
    getHubSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load hub');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MyPortalShell title="My Hub" staffName={profile.name} showFooterNav={false}>
      <InstallPrompt />

      {loadError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {vehicleHandoffError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{vehicleHandoffError}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <ClockTile summary={summary} onClick={() => router.push('/my/attendance')} />
        <VehicleTile
          summary={summary}
          hasVehicle={profile.hasAssignedVehicle}
          pending={vehicleHandoffPending}
          onClick={handleVehicleTap}
        />
        <PayslipsTile summary={summary} onClick={() => router.push('/my/payslips')} />
        <CorrectionsTile
          summary={summary}
          onClick={() => router.push('/my/attendance/corrections')}
        />
      </div>

      <button
        type="button"
        onClick={() => router.push('/my/attendance/history')}
        className="mt-3 w-full text-left rounded-2xl border border-neutral-800 bg-neutral-900 hover:bg-neutral-800/80 transition-colors p-4 flex items-center gap-3"
      >
        <span className="flex w-10 h-10 items-center justify-center rounded-xl bg-neutral-800 text-neutral-300">
          <HistoryIcon className="w-5 h-5" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-medium text-neutral-100">History</span>
          <span className="block text-xs text-neutral-400">
            {summary
              ? `${summary.recentEntryCount} ${summary.recentEntryCount === 1 ? 'entry' : 'entries'} in the last 14 days`
              : 'Loading…'}
          </span>
        </span>
      </button>
    </MyPortalShell>
  );
}

function ClockTile({ summary, onClick }: { summary: HubSummary | null; onClick: () => void }) {
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

function VehicleTile({
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
  if (!hasVehicle) {
    return (
      <Tile
        icon={<Car className="w-5 h-5" />}
        iconClass="bg-neutral-800 text-neutral-500"
        title="My Vehicle"
        subtitle="No vehicle assigned"
        disabled
      />
    );
  }

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

function PayslipsTile({
  summary,
  onClick,
}: {
  summary: HubSummary | null;
  onClick: () => void;
}) {
  const latest = summary?.latestPayslip;
  if (!latest) {
    return (
      <Tile
        onClick={onClick}
        icon={<FileText className="w-5 h-5" />}
        iconClass="bg-neutral-800 text-neutral-500"
        title="Payslips"
        subtitle={summary === null ? 'Loading…' : 'No payslips yet'}
      />
    );
  }
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

function CorrectionsTile({
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
