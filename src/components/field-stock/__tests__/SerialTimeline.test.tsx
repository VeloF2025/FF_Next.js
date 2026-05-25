/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SerialTimeline, eventTypeLabel } from '../SerialTimeline';

describe('SerialTimeline', () => {
  it('renders empty state when entries is empty', () => {
    render(<SerialTimeline entries={[]} hasRealEvents={false} />);
    expect(screen.getByText(/no lifecycle data recorded/i)).toBeInTheDocument();
  });
});

describe('eventTypeLabel', () => {
  it('maps known event types to human labels', () => {
    expect(eventTypeLabel('wa_photo_sighting')).toBe('Seen in WhatsApp photo');
    expect(eventTypeLabel('installed_at_drop')).toBe('Installed at drop');
    expect(eventTypeLabel('activated')).toBe('Activated');
  });

  it('humanizes unknown event types instead of showing raw snake_case', () => {
    expect(eventTypeLabel('returned_to_store')).toBe('Returned to store');
  });
});

describe('SerialTimeline event row', () => {
  it('renders event_type, state transition, actor, timestamp', () => {
    render(
      <SerialTimeline
        hasRealEvents={true}
        entries={[
          {
            kind: 'event',
            id: 'evt-1',
            eventType: 'activated',
            fromState: 'installed',
            toState: 'activated',
            occurredAt: '2026-05-20T10:30:00Z',
            sourceTable: 'oes_pp_data',
            sourceId: 'src-1',
            actorName: 'Hein van Vuuren',
            payload: { resolution_status: 'activated' },
          },
        ]}
      />
    );
    expect(screen.getByText('Activated')).toBeInTheDocument();
    expect(screen.getByText(/installed → activated/i)).toBeInTheDocument();
    expect(screen.getByText(/Hein van Vuuren/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-05-20 10:30/)).toBeInTheDocument();
  });

  it('toggles payload visibility on click', () => {
    render(
      <SerialTimeline
        hasRealEvents={true}
        entries={[
          {
            kind: 'event',
            id: 'evt-1',
            eventType: 'installed_at_drop',
            fromState: 'issued',
            toState: 'installed',
            occurredAt: '2026-05-20T10:30:00Z',
            sourceTable: 'drops',
            sourceId: 'drop-1',
            actorName: null,
            payload: { drop_number: 'DR0001MOH' },
          },
        ]}
      />
    );
    expect(screen.queryByText(/DR0001MOH/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show payload/i }));
    expect(screen.getByText(/DR0001MOH/)).toBeInTheDocument();
  });
});

describe('SerialTimeline pseudo row', () => {
  it('renders pseudo entries with label + description', () => {
    render(
      <SerialTimeline
        hasRealEvents={false}
        entries={[
          {
            kind: 'pseudo',
            id: 'pseudo-received',
            label: 'Received into stock',
            occurredAt: '2026-04-01T00:00:00Z',
            description: 'Inferred from stock_serials.received_date',
          },
        ]}
      />
    );
    expect(screen.getByText('Received into stock')).toBeInTheDocument();
    expect(screen.getByText(/Inferred from stock_serials/i)).toBeInTheDocument();
    expect(screen.getByText(/No events recorded in the event log/i)).toBeInTheDocument();
  });
});
