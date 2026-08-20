import React from 'react';
import { useRouter } from 'next/router';
import { AlertCircle, History as HistoryIcon } from 'lucide-react';

import type { AccountStatus, AttendanceProfile, StaffRole } from './api';
import { AttendanceRequiredActionCard } from './AttendanceRequiredActionCard';
import { ComplianceReminders } from './ComplianceReminders';
import { InstallPrompt } from './InstallPrompt';
import { MyPortalShell } from './MyPortalShell';
import { useMyHubData } from './useMyHubData';
import { isStoresAuthorised } from '@/modules/field-stock-pwa/lib/storesRoles';
import {
  ClockTile,
  CorrectionsTile,
  FleetIncidentsTile,
  HsCheckinTile,
  HsCrewCheckinTile,
  ParkingTile,
  PayslipsTile,
  ReceiptsTile,
  SiteCamTile,
  StoresTile,
  VehicleTile,
} from './tiles';
import { TileGroup } from './TileGroup';

function canSeeSiteCam(
  _role: StaffRole | null,
  _authRole: string | null,
  _accountStatus: AccountStatus
): boolean {
  return true;
}

interface MyHubProps {
  profile: AttendanceProfile;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function MyHub({ profile }: MyHubProps) {
  const router = useRouter();
  const data = useMyHubData(profile);
  const isPending = profile.accountStatus === 'pending';
  const requiredAction = data.summary?.requiredAttendanceAction;
  const openRequiredCorrection = React.useCallback(() => {
    if (!requiredAction) return;
    router.push(
      `/my/attendance/corrections/new?entry_id=${encodeURIComponent(requiredAction.entryId)}` +
      `&exception_id=${encodeURIComponent(requiredAction.exceptionId)}`
    );
  }, [requiredAction, router]);

  // Explicit, because a heading over an empty group is the failure mode here.
  const showCrewCheckin = !isPending && data.canCrewCheckin;
  const showStores = !isPending && isStoresAuthorised(profile.role, profile.authRole);
  const showSiteCam = canSeeSiteCam(profile.role, profile.authRole, profile.accountStatus);
  const showTools = showStores || showSiteCam;

  return (
    <MyPortalShell
      title="My Hub"
      staffName={profile.name}
      staffPhotoUrl={profile.profilePhotoUrl}
      showFooterNav={false}
    >
      <InstallPrompt />
      {data.loadError && <ErrorBanner message={data.loadError} />}
      {data.vehicleHandoffError && <ErrorBanner message={data.vehicleHandoffError} />}

      {isPending && (
        <div className="mb-4 rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Your registration is pending approval by an admin. You can clock in now —
          stock issued to you is limited to R5,000 until you&apos;re approved.
        </div>
      )}

      {requiredAction && (
        <AttendanceRequiredActionCard
          action={requiredAction}
          onCorrect={openRequiredCorrection}
        />
      )}

      <ComplianceReminders
        hsStatus={
          data.hsCheckinUnavailable
            ? 'unavailable'
            : data.hsCheckin?.completed === false ? 'due' : null
        }
        vehicleCheckStatus={
          data.summary?.assignedVehicle
            ? data.summary.assignedVehicle.checkStatusAvailable
              ? data.summary.assignedVehicle.requiredCheckType
              : 'unavailable'
            : null
        }
        vehicleRegistration={data.summary?.assignedVehicle?.registration ?? null}
        vehiclePending={data.vehicleHandoffPending}
        onHsCheckin={() => router.push('/my/hs-checkin')}
        onVehicleCheck={(checkType) => void data.handleVehicleTap(checkType)}
      />

      {/*
        Grouped rather than one flat grid. Ten tiles in a single 2-column list
        had no scent: a driver looking for their parking address scanned past
        Payslips and Receipts to find it. Groups also give the next feature an
        obvious home instead of being appended to the end.

        Visibility is computed above as explicit booleans rather than by
        counting rendered children — `{cond && <Tile/>}` yields `false`, not
        nothing, so child-counting would render a heading over an empty group.
        Note SiteCam is deliberately NOT gated on isPending; that predates this
        change and is preserved.
      */}
      <TileGroup title="Time &amp; attendance">
        <ClockTile summary={data.summary} onClick={() => router.push('/my/attendance')} />
        {!isPending && (
          <CorrectionsTile
            summary={data.summary}
            onClick={() => router.push('/my/attendance/corrections')}
          />
        )}
      </TileGroup>

      <TileGroup title="Health &amp; safety">
        <HsCheckinTile
          status={data.hsCheckin}
          clockedIn={data.summary?.openEntry != null}
          onClick={() => router.push('/my/hs-checkin')}
        />
        {showCrewCheckin && (
          <HsCrewCheckinTile
            recordedToday={data.crewRecordedToday}
            onClick={() => router.push('/my/hs-checkin-crew')}
          />
        )}
      </TileGroup>

      {!isPending && (
        // Renamed from "My vehicle" (PR7 Task 7, design §15): Fleet
        // Incidents belongs here too, and unlike Vehicle/Parking it is
        // shown to every active approved driver regardless of whether
        // they currently have an assigned vehicle — a driver's own past
        // incidents don't disappear just because their assignment did.
        <TileGroup title="Fleet & vehicle">
          <VehicleTile
            summary={data.summary}
            hasVehicle={profile.hasAssignedVehicle}
            pending={data.vehicleHandoffPending}
            onClick={() => void data.handleVehicleTap()}
          />
          <ParkingTile
            hasVehicle={profile.hasAssignedVehicle}
            onClick={() => router.push('/my/vehicle/parking')}
          />
          {profile.accountStatus === 'active' && (
            <FleetIncidentsTile
              summary={data.summary}
              onClick={() => router.push('/my/fleet/incidents')}
            />
          )}
        </TileGroup>
      )}

      {!isPending && (
        <TileGroup title="Pay &amp; expenses">
          <PayslipsTile summary={data.summary} onClick={() => router.push('/my/payslips')} />
          <ReceiptsTile summary={data.summary} onClick={() => router.push('/my/receipts')} />
        </TileGroup>
      )}

      {showTools && (
        <TileGroup title="Tools">
          {showStores && <StoresTile onClick={() => router.push('/my/stores')} />}
          {showSiteCam && <SiteCamTile onClick={() => router.push('/my/sitecam')} />}
        </TileGroup>
      )}

      <button
        type="button"
        onClick={() => router.push('/my/attendance/history')}
        className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-left transition-colors hover:bg-neutral-800/80"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-800 text-neutral-300">
          <HistoryIcon className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-medium text-neutral-100">History</span>
          <span className="block text-xs text-neutral-400">
            {data.summary
              ? `${data.summary.recentEntryCount} ${data.summary.recentEntryCount === 1 ? 'entry' : 'entries'} in the last 14 days`
              : 'Loading…'}
          </span>
        </span>
      </button>
    </MyPortalShell>
  );
}
