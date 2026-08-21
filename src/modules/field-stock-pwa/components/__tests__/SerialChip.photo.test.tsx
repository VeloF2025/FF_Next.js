/**
 * SerialChip — offering the camera on a refusal a photo would fix.
 *
 * Field report 2026-08-21: two Gizzu serials came back "Serial number not
 * found" and the storeman had nowhere to go, so the handout went unrecorded.
 * A single unit has no carton to corroborate it, so the label photo is the
 * evidence — and the affordance has to be ON the refused row, where the person
 * is looking.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SerialChip } from '../SerialChip';
import type { PwaScannedSerial } from '../../types';

function row(over: Partial<PwaScannedSerial>): PwaScannedSerial {
  return {
    serialNumber: 'GU18W12V2601016741', stockItemId: 'i', stockItemName: 'FT-GIZZU',
    scannedAt: 1, state: 'invalid', ...over,
  };
}

const NOT_IN_SYSTEM = 'Not in the system — take a photo of the label to record it';
/** An unknown serial: the verdict says a photo would admit it. */
const unknown = { errorMessage: NOT_IN_SYSTEM, canPhotograph: true };

describe('the camera affordance', () => {
  it('is offered when the serial is unknown to stock', () => {
    render(<SerialChip serial={row(unknown)} onRemove={vi.fn()} onPhotograph={vi.fn()} />);
    expect(screen.getByLabelText(/photograph the label/i)).toBeTruthy();
  });

  it('names the serial it belongs to', () => {
    // Two Gizzus were refused together; the button must be unambiguous.
    render(<SerialChip serial={row(unknown)} onRemove={vi.fn()} onPhotograph={vi.fn()} />);
    // Both buttons name it, which is the point — neither is ambiguous.
    expect(screen.getByLabelText(/photograph the label for GU18W12V2601016741/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Remove GU18W12V2601016741$/)).toBeTruthy();
  });

  it('is NOT offered for a serial refused on its status', () => {
    // Already issued to another technician. No photograph admits that, and
    // offering one would invite a storeman to try.
    render(<SerialChip serial={row({ errorMessage: 'Serial is not available (status: issued)' })}
      onRemove={vi.fn()} onPhotograph={vi.fn()} />);
    expect(screen.queryByLabelText(/photograph the label/i)).toBeNull();
  });

  it('is NOT offered for a wrong-item refusal', () => {
    render(<SerialChip serial={row({ errorMessage: 'Wrong stock item — scanned FT-ONT, expected FT-GIZZU' })}
      onRemove={vi.fn()} onPhotograph={vi.fn()} />);
    expect(screen.queryByLabelText(/photograph the label/i)).toBeNull();
  });

  it('is NOT offered on a valid row', () => {
    render(<SerialChip serial={row({ state: 'valid', errorMessage: undefined })}
      onRemove={vi.fn()} onPhotograph={vi.fn()} />);
    expect(screen.queryByLabelText(/photograph the label/i)).toBeNull();
  });

  it('does not render the button when no handler is supplied', () => {
    render(<SerialChip serial={row(unknown)} onRemove={vi.fn()} />);
    expect(screen.queryByLabelText(/photograph the label/i)).toBeNull();
  });

  it('still offers remove alongside it', () => {
    render(<SerialChip serial={row(unknown)} onRemove={vi.fn()} onPhotograph={vi.fn()} />);
    expect(screen.getByLabelText(/^Remove /)).toBeTruthy();
  });
});

describe('the affordance is driven by the verdict, not by the copy', () => {
  it('is offered on the flag even if the message is reworded', () => {
    // The message will be reworded or translated eventually. Matching it with
    // a regex loses the camera button silently, with no failing test.
    render(
      <SerialChip
        serial={row({ errorMessage: 'Nie in die stelsel nie', canPhotograph: true })}
        onRemove={vi.fn()}
        onPhotograph={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/photograph the label/i)).toBeTruthy();
  });

  it('is NOT offered when the message merely mentions a photo', () => {
    // A status refusal that happens to talk about photos must not offer one.
    render(
      <SerialChip
        serial={row({ errorMessage: 'Already issued — see the photo on the picking' })}
        onRemove={vi.fn()}
        onPhotograph={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/photograph the label/i)).toBeNull();
  });
});

