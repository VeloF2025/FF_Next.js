import { describe, expect, it } from 'vitest';
import type { LiveVehicleTelemetry } from '../operationsPresentationApi';
import { reconcileOperationalOverlay } from '../mapOverlayFilters';
import type { OperationalMapOverlay } from '../../mapOverlayService';

const overlay: OperationalMapOverlay = {
  badges: [{ vehicleId: 'vehicle-missing', staffId: 'staff-1', staffName: 'Missing Join', projectId: 'project-1',
    projectName: 'Project One', operationalSiteId: 'site-1', operationalSiteName: 'Site One', status: 'late',
    flags: [], reasonCodes: [], evidenceTimestamps: [], ruleId: 'rule-1', ruleVersion: 1 }],
  attendancePoints: [], unplottable: [], page: 1, limit: 100, total: 1, hasMore: false,
  workDate: '2026-08-14', evaluatedAt: '2026-08-14T08:00:00.000Z',
};
const vehicles: LiveVehicleTelemetry[] = [{ vehicleId: 'another-vehicle', registration: 'ABC 123', driverName: null,
  provider: null, lat: -26.1, lon: 28.1, speedKph: null, ignition: null, isSpeeding: null, recordedAt: null,
  ageSeconds: null, isStale: false, staleAfterSeconds: 300, trackingState: 'tracked' }];

describe('map overlay telemetry reconciliation', () => {
  it('turns a badge without a telemetry coordinate join into an explained client-unplottable row', () => {
    const reconciled = reconcileOperationalOverlay(overlay, vehicles);

    expect(reconciled.badges).toEqual([]);
    expect(reconciled.unplottable).toEqual([expect.objectContaining({
      staffId: 'staff-1', staffName: 'Missing Join', reason: 'vehicle_telemetry_unavailable',
    })]);
    expect(reconciled.total).toBe(1);
  });
});
