import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ZoneDeliveryView } from '../../types/zoneDelivery.types';
import { HandoverEvidencePanel } from '../HandoverEvidencePanel';
import { zoneFixture } from './zoneDeliveryWorkspaceFixture';

describe('HandoverEvidencePanel document links', () => {
  it('renders an unsafe source ref as text instead of a navigation link', () => {
    const zone = {
      ...zoneFixture,
      documents: [{
        id: 'unsafe-fac',
        documentType: 'fac',
        sourceRef: 'javascript:alert(1)',
        url: null,
        checksumSha256: 'a'.repeat(64),
        active: true,
      }],
    } as ZoneDeliveryView;
    render(
      <HandoverEvidencePanel
        zone={zone}
        canManage={false}
        mutating={false}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Active FAC' })).not.toBeInTheDocument();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });

  it('keeps approved storage URLs navigable', () => {
    render(
      <HandoverEvidencePanel
        zone={zoneFixture}
        canManage={false}
        mutating={false}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Active FAC' }))
      .toHaveAttribute('href', '/storage/fac.pdf');
  });
});
