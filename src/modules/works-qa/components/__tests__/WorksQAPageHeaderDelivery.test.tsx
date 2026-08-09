import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { WorksQAPageHeader } from '../WorksQAPageHeader';

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('../SnagReportButton', () => ({ SnagReportButton: () => <div /> }));
vi.mock('../WorksQAFiltersBar', () => ({ WorksQAFiltersBar: () => <div /> }));

const renderHeader = (zoneNo: number | null, ponNo: number | null) => render(
  <WorksQAPageHeader
    projectName="Lawley"
    projectId="p-1"
    zones={[]}
    zoneNo={zoneNo}
    ponNo={ponNo}
    poleId={null}
    zonesLoading={false}
    syncing={false}
    onBack={() => undefined}
    onSync={() => undefined}
    onChange={() => undefined}
  />,
);

const submitPon = () => screen.queryByRole('button', { name: /Submit PON/ });
const zoneHandover = () => screen.queryByRole('button', { name: /Zone Handover/ });

describe('WorksQAPageHeader delivery controls', () => {
  it('offers Submit PON when a PON is selected', () => {
    renderHeader(20, 212);
    expect(submitPon()).toBeInTheDocument();
    expect(zoneHandover()).not.toBeInTheDocument();
  });

  it('offers Zone Handover on a zone with All PONs, exactly as Johan described it', () => {
    renderHeader(20, null);
    expect(zoneHandover()).toBeInTheDocument();
    expect(submitPon()).not.toBeInTheDocument();
  });

  it('offers neither before a zone is chosen', () => {
    renderHeader(null, null);
    expect(submitPon()).not.toBeInTheDocument();
    expect(zoneHandover()).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tracker' })).not.toBeInTheDocument();
  });

  it('links to the tracker once a zone is in context', () => {
    renderHeader(20, null);
    expect(screen.getByRole('link', { name: 'Tracker' })).toHaveAttribute('href', '/field-ops/tracker');
  });
});
