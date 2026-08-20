/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { OperationalMapOverlay } from '../../mapOverlayService';
import { MapAttentionPanel } from '../MapAttentionPanel';
import { filterOperationalOverlay } from '../mapOverlayFilters';

const overlay: OperationalMapOverlay = {
  badges: [
    {
      vehicleId: 'vehicle-late', staffId: 'staff-late', staffName: 'Late Driver', projectId: 'project-1',
      projectName: 'Lawley', operationalSiteId: 'site-1', operationalSiteName: 'Zone A', status: 'late',
      flags: ['attendance_missing'], reasonCodes: ['arrival_not_confirmed'], evidenceTimestamps: ['2026-08-14T08:00:00.000Z'],
      ruleId: 'rule-1', ruleVersion: 1,
    },
    {
      vehicleId: 'vehicle-normal', staffId: 'staff-normal', staffName: 'Normal Driver', projectId: 'project-1',
      projectName: 'Lawley', operationalSiteId: 'site-1', operationalSiteName: 'Zone A', status: 'on_site_dual',
      flags: [], reasonCodes: [], evidenceTimestamps: ['2026-08-14T08:00:00.000Z'], ruleId: 'rule-1', ruleVersion: 1,
    },
    {
      vehicleId: 'vehicle-stale', staffId: 'staff-stale', staffName: 'Stale Driver', projectId: 'project-1',
      projectName: 'Lawley', operationalSiteId: 'site-1', operationalSiteName: 'Zone A', status: 'wrong_site',
      flags: ['gps_stale'], reasonCodes: ['wrong_site'], evidenceTimestamps: ['2026-08-14T07:00:00.000Z'],
      ruleId: 'rule-1', ruleVersion: 1,
    },
  ],
  attendancePoints: [{
    staffId: 'staff-attendance', staffName: 'Attendance Driver', projectId: 'project-1', operationalSiteId: 'site-1',
    status: 'wrong_site', latitude: -26.1, longitude: 28.1, recordedAt: '2026-08-14T08:00:00.000Z',
    source: 'attendance_clock_in', live: false, label: 'Attendance check-in evidence — not live tracking',
  }],
  unplottable: [{
    staffId: 'staff-missing', staffName: 'Missing Driver', projectId: 'project-1', operationalSiteId: 'site-1',
    status: 'unverifiable', reason: 'no_permissible_coordinate',
  }],
  page: 1, limit: 100, total: 5, hasMore: false, workDate: '2026-08-14', evaluatedAt: '2026-08-14T08:00:00.000Z',
};

function PanelHarness() {
  const [selected, setSelected] = useState<string | null>(null);
  return <MapAttentionPanel operationalOverlay={overlay} onFocusStaff={setSelected} selectedStaffId={selected} />;
}

describe('filterOperationalOverlay', () => {
  it('filters status groups, primary statuses, and evidence without fabricating missing coordinates', () => {
    const onSite = filterOperationalOverlay(overlay, { group: 'on_site' });
    expect(onSite.badges.map((row) => row.staffName)).toEqual(['Normal Driver']);
    expect(onSite.attendancePoints).toEqual([]);
    expect(onSite.unplottable).toEqual([]);

    const wrongSite = filterOperationalOverlay(overlay, { status: 'wrong_site' });
    expect(wrongSite.badges.map((row) => row.staffName)).toEqual(['Stale Driver']);
    expect(wrongSite.attendancePoints.map((row) => row.staffName)).toEqual(['Attendance Driver']);

    expect(filterOperationalOverlay(overlay, { evidence: 'vehicle_only' }).badges
      .map((row) => row.staffName)).toEqual(['Late Driver']);
    const missing = filterOperationalOverlay(overlay, { evidence: 'missing' });
    expect(missing.unplottable.map((row) => row.staffName)).toEqual(['Missing Driver']);
    expect(missing.badges).toEqual([]);
    expect(filterOperationalOverlay(overlay, { evidence: 'stale' }).badges[0]?.staffName).toBe('Stale Driver');
    expect(filterOperationalOverlay(overlay, { evidence: 'attendance_only' }).attendancePoints[0]?.staffName)
      .toBe('Attendance Driver');
    expect(filterOperationalOverlay(overlay, { evidence: 'dual' }).badges[0]?.staffName).toBe('Normal Driver');

    const sourceFailure = { ...overlay, badges: [{ ...overlay.badges[1]!, flags: ['evidence_source_error'] as const }] };
    expect(filterOperationalOverlay(sourceFailure, { evidence: 'missing' }).badges[0]?.staffName).toBe('Normal Driver');
  });
});

describe('MapAttentionPanel', () => {
  it('defaults to actionable rows and explains staff without plottable evidence', () => {
    render(<MapAttentionPanel operationalOverlay={overlay} onFocusStaff={vi.fn()} selectedStaffId={null} />);
    const desktop = screen.getByTestId('map-attention-desktop');
    expect(within(desktop).getByText('Late Driver')).toBeInTheDocument();
    expect(within(desktop).queryByText('Normal Driver')).not.toBeInTheDocument();
    expect(within(desktop).getByText('Missing Driver')).toBeInTheDocument();
    expect(within(desktop).getByText('No permissible location evidence; this person is not plotted.')).toBeInTheDocument();
    expect(within(desktop).getByText('Attendance check-in evidence — not live tracking')).toBeInTheDocument();
  });

  it('discloses when the server truncated the roster fetch below the true total', () => {
    render(<MapAttentionPanel operationalOverlay={overlay} onFocusStaff={vi.fn()} selectedStaffId={null}
      truncated={{ shown: 100, total: 240 }} />);
    const desktop = screen.getByTestId('map-attention-desktop');
    expect(within(desktop).getByText(/Showing 100 of 240/)).toBeInTheDocument();
    expect(within(desktop).getByText(/140 more not shown/)).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('map-attention-mobile'))
      .getByRole('button', { name: 'Expand mobile attention sheet' }));
    expect(within(screen.getByTestId('map-attention-mobile')).getByText(/Showing 100 of 240/)).toBeInTheDocument();
  });

  it('says nothing when the fetch was not truncated', () => {
    render(<MapAttentionPanel operationalOverlay={overlay} onFocusStaff={vi.fn()} selectedStaffId={null}
      truncated={{ shown: 5, total: 5 }} />);
    expect(screen.queryByText(/more not shown/)).not.toBeInTheDocument();
  });

  it('collapses on desktop, expands as a mobile sheet, and retains the selected staff member', () => {
    render(<PanelHarness />);
    const focus = within(screen.getByTestId('map-attention-desktop'))
      .getByRole('button', { name: 'Focus Late Driver on map' });
    fireEvent.click(focus);
    expect(focus).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse attention panel' }));
    const desktopToggle = screen.getByRole('button', { name: 'Expand attention panel' });
    expect(desktopToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(desktopToggle);
    expect(within(screen.getByTestId('map-attention-desktop'))
      .getByRole('button', { name: 'Focus Late Driver on map' })).toHaveAttribute('aria-pressed', 'true');

    const mobileToggle = screen.getByRole('button', { name: 'Expand mobile attention sheet' });
    expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(mobileToggle);
    expect(screen.getByRole('button', { name: 'Collapse mobile attention sheet' })).toHaveAttribute('aria-expanded', 'true');
  });
});
