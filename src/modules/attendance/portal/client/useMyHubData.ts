import React from 'react';

import { requestFleetHandoff } from './api';
import type { AttendanceProfile } from './api';
import { getAttendanceHubSummary } from './attendanceStateApi';
import type { AttendanceHubSummaryResponse } from './attendanceStateApi';
import type { VehicleCheckDue } from './ComplianceReminders';

export function useMyHubData(profile: AttendanceProfile) {
  const [summary, setSummary] = React.useState<AttendanceHubSummaryResponse | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [vehicleHandoffPending, setVehicleHandoffPending] = React.useState(false);
  const [vehicleHandoffError, setVehicleHandoffError] = React.useState<string | null>(null);
  const [hsCheckin, setHsCheckin] = React.useState<{
    completed: boolean;
    clearance: string | null;
  } | null>(null);
  const [hsCheckinUnavailable, setHsCheckinUnavailable] = React.useState(false);
  const [crewRecordedToday, setCrewRecordedToday] = React.useState<number | null>(null);
  const canCrewCheckin = profile.role === 'supervisor' || profile.role === 'admin';

  const handleVehicleTap = React.useCallback(async (checkType?: VehicleCheckDue) => {
    if (vehicleHandoffPending) return;
    setVehicleHandoffPending(true);
    setVehicleHandoffError(null);
    try {
      const handoff = await requestFleetHandoff();
      const target = checkType
        ? `/fleet/check-in?vehicleId=${encodeURIComponent(handoff.vehicleId)}&type=${checkType}`
        : '/fleet/portal?from=my';
      window.location.assign(target);
    } catch (error) {
      setVehicleHandoffPending(false);
      setVehicleHandoffError(
        error instanceof Error ? error.message : 'Could not open the vehicle portal'
      );
    }
  }, [vehicleHandoffPending]);

  React.useEffect(() => {
    let cancelled = false;
    getAttendanceHubSummary()
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Failed to load hub');
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/my/hs/checkin', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error('H&S check status unavailable');
        return response.json();
      })
      .then((body) => {
        if (cancelled) return;
        if (!body?.data) throw new Error('H&S check status unavailable');
        setHsCheckin({
          completed: Boolean(body.data.completed),
          clearance: body.data.checkin?.clearance ?? null,
        });
      })
      .catch(() => { if (!cancelled) setHsCheckinUnavailable(true); });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!canCrewCheckin) return;
    let cancelled = false;
    fetch('/api/my/hs/checkin-crew', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body?.data) {
          setCrewRecordedToday(
            typeof body.data.recorded_today === 'number' ? body.data.recorded_today : 0
          );
        }
      })
      .catch(() => { if (!cancelled) setCrewRecordedToday(null); });
    return () => { cancelled = true; };
  }, [canCrewCheckin]);

  return {
    summary,
    loadError,
    vehicleHandoffPending,
    vehicleHandoffError,
    hsCheckin,
    hsCheckinUnavailable,
    canCrewCheckin,
    crewRecordedToday,
    handleVehicleTap,
  };
}
