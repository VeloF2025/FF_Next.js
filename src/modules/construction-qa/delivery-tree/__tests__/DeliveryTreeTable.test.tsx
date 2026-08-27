import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeliveryTreeTable } from '../components/DeliveryTreeTable';
import { projectKey, zoneKey } from '../treeKeys';
import type { DeliveryTreeProject } from '../types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

const projects: DeliveryTreeProject[] = [{
  id: PROJECT_ID,
  name: 'Mohadin',
  zones: [{
    zone_no: 3,
    status: 'Maintenance',
    counts: { poles_total: 15, poles_planted: 9, activation_total: 150, activation_complete: 39 },
    pons: [
      {
        pon_no: 12,
        status: 'Optical Submitted',
        counts: { poles_total: 10, poles_planted: 4, activation_total: 120, activation_complete: 9 },
        opticalSubmittedAt: '2026-08-20T09:15:00.000Z',
      },
      {
        pon_no: 13,
        status: 'WIP',
        counts: { poles_total: 5, poles_planted: 5, activation_total: 30, activation_complete: 30 },
        opticalSubmittedAt: null,
      },
    ],
  }],
}];

describe('DeliveryTreeTable', () => {
  it('shows only project rows while everything is collapsed', () => {
    render(<DeliveryTreeTable projects={projects} expanded={new Set()} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Mohadin/ })).toBeVisible();
    expect(screen.queryByText('Zone 3')).not.toBeInTheDocument();
    expect(screen.queryByText('PON 12')).not.toBeInTheDocument();
  });

  it('reveals zone rows once the project is expanded and PON rows once the zone is', () => {
    const { rerender } = render(
      <DeliveryTreeTable projects={projects} expanded={new Set([projectKey(PROJECT_ID)])} onToggle={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: /Zone 3/ })).toBeVisible();
    expect(screen.getByText('Maintenance')).toBeVisible();
    expect(screen.queryByText('PON 12')).not.toBeInTheDocument();

    rerender(
      <DeliveryTreeTable
        projects={projects}
        expanded={new Set([projectKey(PROJECT_ID), zoneKey(PROJECT_ID, 3)])}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText('PON 12')).toBeVisible();
    expect(screen.getByText('Optical Submitted')).toBeVisible();
    expect(screen.getByText('WIP')).toBeVisible();
  });

  it('renders the submission date only for submitted PONs', () => {
    render(
      <DeliveryTreeTable
        projects={projects}
        expanded={new Set([projectKey(PROJECT_ID), zoneKey(PROJECT_ID, 3)])}
        onToggle={vi.fn()}
      />,
    );

    const submitted = screen.getByText('PON 12').closest('tr');
    const pending = screen.getByText('PON 13').closest('tr');
    expect(submitted?.querySelector('time')).toHaveAttribute('dateTime', '2026-08-20T09:15:00.000Z');
    expect(pending?.querySelector('time')).toBeNull();
    expect(pending).toHaveTextContent('—');
  });

  it('reports the toggled row key to the caller', () => {
    const onToggle = vi.fn();
    render(<DeliveryTreeTable projects={projects} expanded={new Set()} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: /Mohadin/ }));
    expect(onToggle).toHaveBeenCalledWith(projectKey(PROJECT_ID));
  });
});
