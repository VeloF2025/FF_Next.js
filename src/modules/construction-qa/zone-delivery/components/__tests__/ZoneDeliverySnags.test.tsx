import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ZoneDeliverySnags } from '../ZoneDeliverySnags';
import { ponStageId, projectId, snagId, zoneFixture } from './zoneDeliveryWorkspaceFixture';

describe('ZoneDeliverySnags', () => {
  it('renders canonical snag evidence and a context-preserving link', () => {
    render(<ZoneDeliverySnags zone={{
      ...zoneFixture,
      snags: [{
        snagId,
        status: 'closed',
        closedAt: '2026-07-10T08:00:00.000Z',
        qaDiscipline: 'civil',
        ponStageId,
        ponNo: 4,
        affectedGate: null,
        handoverBlocking: true,
        requiresReconfirmation: false,
        reconfirmedAt: null,
      }],
    }} />);
    expect(screen.getByText('Civil Zone QA')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('PON 4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `Open snag ${snagId}` }))
      .toHaveAttribute(
        'href',
        `/field-ops/snags?project_id=${encodeURIComponent(projectId)}&zone_no=12&pon_no=4`,
      );
  });
});
