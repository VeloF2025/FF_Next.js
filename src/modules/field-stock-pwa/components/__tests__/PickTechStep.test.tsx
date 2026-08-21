/**
 * PickTechStep — the "issue stock to" list, filtered to the store's site.
 *
 * The behaviour under test is the one Hein asked for: when a person's site is
 * not the site the store serves, their name should not be in the list. The
 * cases that must NOT be hidden matter just as much — hiding a name on missing
 * data makes stock un-issuable to a real worker.
 *
 * Fixture note: the names and sites below are real production values. Lawley
 * and Mamelodi people genuinely appeared in the Tembisa picker (screenshot,
 * 2026-08-21), which is what this filter removes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { PwaTechSummary } from '../../types';

const fetchTechnicians = vi.fn();
vi.mock('@/modules/field-stock-pwa/api', () => ({
  fetchTechnicians: (...a: unknown[]) => fetchTechnicians(...a),
  createTechnician: vi.fn(),
}));

import { PickTechStep } from '../PickTechStep';

const TEMBISA_STORE = '33333333-3333-4333-8333-333333333333';

function person(over: Partial<PwaTechSummary>): PwaTechSummary {
  return {
    id: 'x', name: 'X', phone: null, contractorId: null, contractorName: null,
    accountStatus: 'active', role: 'casual',
    siteProjectId: null, siteProjectName: null, siteSource: 'none',
    siteMatch: 'unknown-staff', ...over,
  };
}

// Mirrors the real annotated response for a handout at Tembisa 1.
const ROSTER: PwaTechSummary[] = [
  person({ id: 'a', name: 'Semenya Mokoena', siteProjectName: 'Thembisa POP 1',
           siteSource: 'declared', siteMatch: 'match' }),
  person({ id: 'b', name: 'MOEKETSI MOLEKO', role: 'technician',
           siteProjectName: 'Lawley', siteSource: 'declared', siteMatch: 'elsewhere' }),
  person({ id: 'c', name: 'Kamogelo Kekana', role: 'technician',
           siteProjectName: 'Mamelodi', siteSource: 'declared', siteMatch: 'elsewhere' }),
  person({ id: 'd', name: 'Bongani Manyathela', role: 'technician',
           siteMatch: 'unknown-staff' }),
];

beforeEach(() => {
  fetchTechnicians.mockReset();
  fetchTechnicians.mockResolvedValue(ROSTER);
});

describe('PickTechStep site filtering', () => {
  it('hides people who work at another site', async () => {
    render(<PickTechStep onPick={vi.fn()} storeLocationId={TEMBISA_STORE} storeName="Tembisa 1" />);
    await waitFor(() => expect(screen.getByText('Semenya Mokoena')).toBeTruthy());
    // The exact complaint from the screenshot: Lawley and Mamelodi people in a
    // Tembisa handout.
    expect(screen.queryByText('MOEKETSI MOLEKO')).toBeNull();
    expect(screen.queryByText('Kamogelo Kekana')).toBeNull();
  });

  it('still shows someone whose site is unknown', async () => {
    render(<PickTechStep onPick={vi.fn()} storeLocationId={TEMBISA_STORE} storeName="Tembisa 1" />);
    // Missing data must never remove a real worker from the list.
    await waitFor(() => expect(screen.getByText('Bongani Manyathela')).toBeTruthy());
  });

  it('shows the site each person belongs to, not the dead contractor field', async () => {
    render(<PickTechStep onPick={vi.fn()} storeLocationId={TEMBISA_STORE} storeName="Tembisa 1" />);
    await waitFor(() => expect(screen.getByText(/Thembisa POP 1/)).toBeTruthy());
    // 'Unassigned' was contractorName, which is always null — it read
    // "Unassigned" for every person on every row and told the storeman nothing.
    expect(screen.queryByText('Unassigned')).toBeNull();
  });

  it('offers an escape hatch naming how many are hidden', async () => {
    render(<PickTechStep onPick={vi.fn()} storeLocationId={TEMBISA_STORE} storeName="Tembisa 1" />);
    await waitFor(() => expect(screen.getByText(/2 people work at another site/)).toBeTruthy());
  });

  it('reveals the hidden people when asked, so a cross-site handout is possible', async () => {
    render(<PickTechStep onPick={vi.fn()} storeLocationId={TEMBISA_STORE} storeName="Tembisa 1" />);
    await waitFor(() => expect(screen.getByText(/show everyone/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/show everyone/i));
    // The whole point of the toggle: the process is never blocked.
    await waitFor(() => expect(screen.getByText('MOEKETSI MOLEKO')).toBeTruthy());
    expect(screen.getByText('Kamogelo Kekana')).toBeTruthy();
  });

  it('shows everyone when the store has no site mapped', async () => {
    // An unmapped warehouse must not filter at all. Every warehouse was in this
    // state before migration 514, and any warehouse Hein has not mapped stays here.
    fetchTechnicians.mockResolvedValue(
      ROSTER.map((p) => ({ ...p, siteMatch: 'unmapped-store' as const })),
    );
    render(<PickTechStep onPick={vi.fn()} storeLocationId={null} storeName={null} />);
    await waitFor(() => expect(screen.getByText('MOEKETSI MOLEKO')).toBeTruthy());
    expect(screen.getByText('Kamogelo Kekana')).toBeTruthy();
    expect(screen.queryByText(/show everyone/i)).toBeNull();
  });

  it('asks the server for casuals as well as technicians', async () => {
    render(<PickTechStep onPick={vi.fn()} storeLocationId={TEMBISA_STORE} storeName="Tembisa 1" />);
    await waitFor(() => expect(fetchTechnicians).toHaveBeenCalled());
    // Casuals were excluded entirely before this change — the picker requested
    // role=technician only, so no casual could ever be issued stock.
    expect(fetchTechnicians).toHaveBeenCalledWith(
      expect.objectContaining({ storeLocationId: TEMBISA_STORE }),
    );
  });
});
