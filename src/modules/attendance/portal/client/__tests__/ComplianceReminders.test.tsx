import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComplianceReminders } from '../ComplianceReminders';

describe('ComplianceReminders', () => {
  it('stays hidden when all checks are complete', () => {
    const { container } = render(
      <ComplianceReminders
        hsStatus={null}
        vehicleCheckStatus={null}
        vehicleRegistration={null}
        vehiclePending={false}
        onHsCheckin={() => {}}
        onVehicleCheck={() => {}}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows both due checks and wires their direct actions', () => {
    const onHsCheckin = vi.fn();
    const onVehicleCheck = vi.fn();

    render(
      <ComplianceReminders
        hsStatus="due"
        vehicleCheckStatus="weekly"
        vehicleRegistration="ABC 123 GP"
        vehiclePending={false}
        onHsCheckin={onHsCheckin}
        onVehicleCheck={onVehicleCheck}
      />
    );

    expect(screen.getByText('Checks due before field work')).toBeInTheDocument();
    expect(screen.getByText('Daily H&S check-in')).toBeInTheDocument();
    expect(screen.getByText('Weekly vehicle inspection')).toBeInTheDocument();
    expect(screen.getByText(/ABC 123 GP pre-trip check is due/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Daily H&S check-in'));
    fireEvent.click(screen.getByText('Weekly vehicle inspection'));

    expect(onHsCheckin).toHaveBeenCalledTimes(1);
    expect(onVehicleCheck).toHaveBeenCalledWith('weekly');
  });

  it('labels a daily vehicle check and disables it while the handoff opens', () => {
    render(
      <ComplianceReminders
        hsStatus={null}
        vehicleCheckStatus="daily"
        vehicleRegistration="XYZ 789 GP"
        vehiclePending
        onHsCheckin={() => {}}
        onVehicleCheck={() => {}}
      />
    );

    const vehicleAction = screen.getByRole('button', { name: /daily vehicle check/i });
    expect(vehicleAction).toBeDisabled();
    expect(screen.getByText('Opening…')).toBeInTheDocument();
  });

  it('surfaces unavailable status instead of treating unknown checks as complete', () => {
    render(
      <ComplianceReminders
        hsStatus="unavailable"
        vehicleCheckStatus="unavailable"
        vehicleRegistration="XYZ 789 GP"
        vehiclePending={false}
        onHsCheckin={() => {}}
        onVehicleCheck={() => {}}
      />
    );

    expect(screen.getByText('H&S check status unavailable')).toBeInTheDocument();
    expect(screen.getByText('Vehicle check status unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('Open checks')).toHaveLength(2);
  });
});
