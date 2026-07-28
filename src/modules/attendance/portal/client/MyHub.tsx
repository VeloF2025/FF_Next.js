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
import type { AccountStatus, AttendanceProfile, HubSummaryResponse, StaffRole } from './api';
import { MyPortalShell } from './MyPortalShell';
import { InstallPrompt } from './InstallPrompt';
import { isStoresAuthorised } from '@/modules/field-stock-pwa/lib/storesRoles';
import {
  ClockTile,
  VehicleTile,
  PayslipsTile,
  ReceiptsTile,
  CorrectionsTile,
  StoresTile,
  SiteCamTile,
  HsCheckinTile,
} from './tiles';

type HubSummary = HubSummaryResponse;

/**
 * SiteCam is shown to every signed-in portal user — including pending,
 * self-registered field technicians, who must be able to capture installation
 * photos in the field from their very first sign-in, before an admin activates
 * them. The matching page gate lives in sitecam/lib/sitecamAuth.isSiteCamAuthorised.
 *
 * To restore the original field-staff gate (technician/supervisor staff roles
 * plus the privileged super_admin/system auth roles), revert this commit and
 * #2042 — together they bring back both this function and isSiteCamAuthorised.
 */
function canSeeSiteCam(_role: StaffRole | null, _authRole: string | null, _accountStatus: AccountStatus): boolean {
  return true;
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

  // Daily H&S check-in status. Loaded separately from hub-summary so a failure
  // here degrades to a "Loading…" tile rather than blanking the whole hub.
  const [hsCheckin, setHsCheckin] = React.useState<
    { completed: boolean; clearance: string | null } | null
  >(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/my/hs/checkin', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data) return;
        setHsCheckin({
          completed: Boolean(j.data.completed),
          clearance: j.data.checkin?.clearance ?? null,
        });
      })
      .catch(() => {
        /* tile stays in its loading state; the hub itself must still render */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const isPending = profile.accountStatus === 'pending';

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

      {isPending && (
        <div className="mb-4 rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Your registration is pending approval by an admin. You can clock in now —
          stock issued to you is limited to R5,000 until you&apos;re approved.
        </div>
      )}

      {isPending ? (
        <div className="grid grid-cols-2 gap-3">
          <ClockTile summary={summary} onClick={() => router.push('/my/attendance')} />
          <HsCheckinTile status={hsCheckin} onClick={() => router.push('/my/hs-checkin')} />
          {canSeeSiteCam(profile.role, profile.authRole, profile.accountStatus) && (
            <SiteCamTile onClick={() => router.push('/my/sitecam')} />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <ClockTile summary={summary} onClick={() => router.push('/my/attendance')} />
          <HsCheckinTile status={hsCheckin} onClick={() => router.push('/my/hs-checkin')} />
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
          {canSeeSiteCam(profile.role, profile.authRole, profile.accountStatus) && (
            <SiteCamTile onClick={() => router.push('/my/sitecam')} />
          )}
        </div>
      )}

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
