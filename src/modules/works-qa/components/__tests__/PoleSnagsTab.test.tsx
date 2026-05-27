import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { PoleSnagsTab } from '../PoleSnagsTab';
import type { PoleSnag } from '../../hooks/usePoleSnags';

const fetchMock = vi.fn();

function makeSnag(overrides: Partial<PoleSnag>): PoleSnag {
  return {
    id: 's1',
    pole_qa_photo_id: 'pq1',
    slot_key: 'before_photo',
    slot_photo_key: null,
    discipline: 'civil',
    description: 'desc',
    severity: 'major',
    status: 'open',
    noc_ticket_id: null,
    ticket_uid: null,
    assigned_to: null,
    assignee_name: null,
    pole_label: 'ETW.P.H218',
    created_at: '2026-05-26T09:00:00.000Z',
    ...overrides,
  };
}

function mockSnags(snags: PoleSnag[]): void {
  fetchMock.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/api/works-qa/photo-snags')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { snags } }) });
    }
    return Promise.resolve({ ok: false, json: async () => ({ error: 'unhandled' }) });
  });
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('PoleSnagsTab', () => {
  // Regression: pole-level snags (planted-check / "other issue") have a NULL
  // slot_key. The list previously called snag.slot_key.replace(...) directly and
  // crashed the SNAGS tab with "Cannot read properties of null (reading 'replace')".
  it('renders a pole-level snag with null slot_key without throwing', async () => {
    mockSnags([makeSnag({ id: 'pole-level', slot_key: null, discipline: null, description: 'Pole not planted' })]);

    render(<PoleSnagsTab poleId="pq1" onChanged={() => {}} />, { wrapper });

    await waitFor(() => expect(screen.getByText('Pole-level')).toBeInTheDocument());
    expect(screen.getByText('Pole not planted')).toBeInTheDocument();
  });

  it('humanises slot_key for a normal photo-slot snag', async () => {
    mockSnags([makeSnag({ slot_key: 'depth_photo' })]);

    render(<PoleSnagsTab poleId="pq1" onChanged={() => {}} />, { wrapper });

    await waitFor(() => expect(screen.getByText('depth photo')).toBeInTheDocument());
  });
});
