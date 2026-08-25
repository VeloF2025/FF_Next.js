/**
 * `accident_sos` is a stub, and this suite pins it as one.
 *
 * The failure this guards against is a well-meaning future edit that derives an
 * SOS from a hard stop or a high g reading. `accident_sos` is `critical`, so
 * such an edit would send an immediate WhatsApp about a crash that did not
 * happen — and a false emergency once is a channel nobody trusts again. There
 * is no SOS field on any of the three feeds (PR0/U1); until a provider supplies
 * one, zero is the correct output for every input.
 */

import { describe, expect, it } from 'vitest';
import { detectAccidentSos } from '../accidentSosDetector';
import { context, position } from './detectorFixtures';

describe('detectAccidentSos', () => {
  it('returns nothing for a violent deceleration', () => {
    const positions = [position({ linearG: -1.2, lateralG: 0.9, speedKph: 120 })];

    expect(detectAccidentSos(context({ positions }))).toEqual([]);
  });

  it('returns nothing for a harsh-braking event followed by permanent silence', () => {
    const positions = [position({ providerEventType: 'HARSH_BRAKING', speedKph: 110 })];

    expect(detectAccidentSos(context({ positions, now: '2026-09-01T00:00:00.000Z' }))).toEqual([]);
  });

  it('returns nothing for an empty window', () => {
    expect(detectAccidentSos(context())).toEqual([]);
  });
});
