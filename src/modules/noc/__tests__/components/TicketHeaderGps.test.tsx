/**
 * Guards the CALL SITE of the GPS ranking, not the ranking itself.
 *
 * `selectTicketGpsDisplay` is well covered as a pure function, but its
 * `ticketSource` parameter is optional — so deleting `ticketSource: ticket.source`
 * from TicketHeader type-checks, passes every other test, and silently restores
 * the bug that made a snags ticket's pin jump 94.7km onto a bogus OES fix. The
 * call site is exactly where that bug lived, and it had no test.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketHeader } from '../../components/TicketDetail/TicketHeader';
import type { EnrichedTicket } from '../../types/ticket';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', role: 'admin', permissions: [] } }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../../components/TicketDetail/ClickableStatusBadge', () => ({
  ClickableStatusBadge: () => <span>status</span>,
}));
vi.mock('../../components/TicketDetail/ClickablePriorityBadge', () => ({
  ClickablePriorityBadge: () => <span>priority</span>,
}));

/** Real values from DR1734917: the snags capture, and its 94.7km-away OES row. */
const CAPTURED = { latitude: -26.38318537404762, longitude: 27.80789118854532 };
const OES_FAR = { latitude: -25.5457433, longitude: 27.9828739 };

function ticket(over: Partial<EnrichedTicket> = {}): EnrichedTicket {
  return {
    id: 't1',
    ticket_uid: 'VF-TEST-001',
    title: 'Test',
    status: 'assigned',
    priority: 'normal',
    source: 'snags',
    dr_number: 'DR1734917',
    gps_coordinates: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  } as unknown as EnrichedTicket;
}

const enrichment = (over: Record<string, unknown> = {}) =>
  ({
    fibreflow_gps: { ...CAPTURED, address: null },
    oes_gps: { ...OES_FAR, address: null },
    gps_divergence_m: 94748,
    sow_match_found: true,
    onemap_match_found: false,
    onemap_gps: null,
    fibreflow_pole_number: null,
    fibreflow_pon: null,
    fibreflow_zone: null,
    fibreflow_contractor: null,
    fibreflow_municipality: null,
    onemap_customer_name: null,
    onemap_contact_number: null,
    onemap_address: null,
    project: null,
    project_match_found: false,
    ...over,
  }) as never;

/** Every maps URL the header rendered. */
function mapHrefs(): string[] {
  return Array.from(document.querySelectorAll('a[href*="google.com/maps"]')).map(
    (a) => (a as HTMLAnchorElement).href
  );
}

describe('TicketHeader — the OES ranking must stay scoped at the call site', () => {
  it('does NOT link a snags ticket to the OES coordinate', () => {
    render(<TicketHeader ticket={ticket({ fibreflow_enrichment: enrichment() })} />);

    const hrefs = mapHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    // The technician's own capture, never the 94.7km-away OES fix.
    expect(hrefs.every((h) => h.includes('-26.383185'))).toBe(true);
    expect(hrefs.some((h) => h.includes('-25.545743'))).toBe(false);
    expect(screen.queryByText(/OES report/)).toBeNull();
  });

  it('DOES link an olt_mismatch ticket to the OES coordinate', () => {
    render(
      <TicketHeader
        ticket={ticket({ source: 'olt_mismatch', fibreflow_enrichment: enrichment() })}
      />
    );

    expect(mapHrefs().some((h) => h.includes('-25.545743'))).toBe(true);
    expect(screen.getByText(/OES report/)).toBeInTheDocument();
  });

  it('warns, with the distance, when the two disagree on a scoped ticket', () => {
    render(
      <TicketHeader
        ticket={ticket({ source: 'olt_mismatch', fibreflow_enrichment: enrichment() })}
      />
    );

    expect(screen.getByText(/94748m away/)).toBeInTheDocument();
    expect(screen.getByText(/verify on site/)).toBeInTheDocument();
    // Both pins offered — the tech decides.
    expect(mapHrefs().some((h) => h.includes('-26.383185'))).toBe(true);
  });

  it('stays quiet when the two agree closely', () => {
    render(
      <TicketHeader
        ticket={ticket({
          source: 'olt_mismatch',
          fibreflow_enrichment: enrichment({ gps_divergence_m: 12 }),
        })}
      />
    );

    expect(screen.queryByText(/verify on site/)).toBeNull();
  });

  it('renders a scoped ticket that has only an OES coordinate', () => {
    // 65 open olt_mismatch tickets have no sow_drops row; before this work they
    // showed no location at all.
    render(
      <TicketHeader
        ticket={ticket({
          source: 'olt_mismatch',
          fibreflow_enrichment: enrichment({
            fibreflow_gps: null,
            sow_match_found: false,
            gps_divergence_m: null,
          }),
        })}
      />
    );

    expect(mapHrefs().some((h) => h.includes('-25.545743'))).toBe(true);
  });
});
