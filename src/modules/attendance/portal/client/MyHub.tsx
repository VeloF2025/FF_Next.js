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
 *
 * Tile presentation lives in ./tiles; this file owns data loading, the
 * role gates, and grid layout.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { History as HistoryIcon, AlertCircle } from 'lucide-react';

import { getHubSummary, requestFleetHandoff } from './api';
import type { AttendanceProfile, HubSummaryResponse, StaffRole } from './api';
import { MyPortalShell } from './MyPortalShell';
import { InstallPrompt } from './InstallPrompt';
import { isStoresAuthorised, STORES_AUTH_ROLES } from '@/modules/field-stock-pwa/lib/storesRoles';
import {
  ClockTile,
  VehicleTile,
  PayslipsTile,
  ReceiptsTile,
  CorrectionsTile,
  StoresTile,
  SiteCamTile,
} from './tiles';

type HubSummary = HubSummaryResponse;

/** Staff roles whose holders capture installation photos via SiteCam. */
const SITECAM_ROLES: ReadonlyArray<StaffRole> = ['technician', 'supervisor'];

/**
 * SiteCam is visible to field staff (technician/supervisor) and to the
 * privileged auth roles that already see every operational tile
 * (super_admin/system, shared with the Stores gate).
 */
function canSeeSiteCam(role: StaffRole | null, authRole: string | null): boolean {
  if (role !== null && SITECAM_ROLES.includes(role)) return true;
  return authRole !== null && (STORES_AUTH_ROLES as ReadonlyArray<string>).includes(authRole);
}

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
    <MyPortalShell title="My Hub" staffName={profile.name} staffPhotoUrl={profile.profilePhotoUrl} showFooterNav={false}>
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
        <ReceiptsTile summary={summary} onClick={() => router.push('/my/receipts')} />
        <CorrectionsTile
          summary={summary}
          onClick={() => router.push('/my/attendance/corrections')}
        />
        {isStoresAuthorised(profile.role, profile.authRole) && (
          <StoresTile onClick={() => router.push('/my/stores')} />
        )}
        {canSeeSiteCam(profile.role, profile.authRole) && (
          <SiteCamTile onClick={() => router.push('/my/sitecam')} />
        )}
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
