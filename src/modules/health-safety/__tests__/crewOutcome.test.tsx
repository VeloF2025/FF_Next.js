/**
 * CrewOutcome — the panel must make a partial result impossible to misread.
 *
 * The invariant under test: `recorded` being smaller than the crew submitted
 * is never the only signal. Everyone not recorded is named with a reason,
 * every blocked worker is named with why, and unverified contractor links are
 * listed rather than silently accepted.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CrewOutcome } from '../components/checkin/CrewOutcome';

const partialResult = {
  recorded: 2,
  skipped: ['Thabo M'],
  contractor_link_unverified: ['Sipho D'],
  blocked: 1,
  checkins: [
    { worker_name: 'Sipho D', clearance: 'cleared', blocked_reasons: [] },
    { worker_name: 'Anna K', clearance: 'blocked', blocked_reasons: ['self_declared_unfit'] },
  ],
};

describe('CrewOutcome', () => {
  it('names every worker who was not recorded, blocked, or unverified', () => {
    render(
      <CrewOutcome
        requested={3}
        result={partialResult}
        onRecordAnother={() => {}}
        onDone={() => {}}
      />
    );

    // The headline states the shortfall in numbers…
    expect(screen.getByText('Recorded 2 of 3')).toBeInTheDocument();
    // …and the skipped worker is named with the reason, not just counted.
    expect(screen.getByText(/already checked in today/i)).toBeInTheDocument();
    expect(screen.getByText('Thabo M')).toBeInTheDocument();

    // Blocked worker named, with a human reason.
    expect(screen.getByText('Anna K')).toBeInTheDocument();
    expect(screen.getByText(/marked not fit for duty/i)).toBeInTheDocument();

    // Unverified contractor link surfaced, not swallowed.
    expect(screen.getByText('Sipho D')).toBeInTheDocument();
    expect(screen.getByText(/does not link them to this contractor/i)).toBeInTheDocument();
  });

  it('shows a clean full-crew success without warning sections', () => {
    render(
      <CrewOutcome
        requested={2}
        result={{
          recorded: 2,
          skipped: [],
          contractor_link_unverified: [],
          blocked: 0,
          checkins: [
            { worker_name: 'A One', clearance: 'cleared', blocked_reasons: [] },
            { worker_name: 'B Two', clearance: 'cleared', blocked_reasons: [] },
          ],
        }}
        onRecordAnother={() => {}}
        onDone={() => {}}
      />
    );
    expect(screen.getByText('Recorded 2 of 2')).toBeInTheDocument();
    expect(screen.queryByText(/already checked in today/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NOT cleared to start/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not link them to this contractor/i)).not.toBeInTheDocument();
  });

  it('wires both actions', () => {
    const onRecordAnother = vi.fn();
    const onDone = vi.fn();
    render(
      <CrewOutcome
        requested={3}
        result={partialResult}
        onRecordAnother={onRecordAnother}
        onDone={onDone}
      />
    );
    fireEvent.click(screen.getByText('Record another crew'));
    fireEvent.click(screen.getByText('Back to hub'));
    expect(onRecordAnother).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
