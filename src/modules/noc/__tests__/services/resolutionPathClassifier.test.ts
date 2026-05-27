/**
 * Unit tests for classifyResolutionPath.
 *
 * Pure function — no DB / module mocks needed.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyResolutionPath,
  isResolutionPath,
} from '../../services/resolutionPathClassifier';
import { ResolutionPath, TicketType } from '../../types/ticket';

describe('classifyResolutionPath', () => {
  describe('not_applicable disciplines', () => {
    it('returns NOT_APPLICABLE for dev_ops by type', () => {
      expect(
        classifyResolutionPath({ ticket_type: TicketType.DEV_OPS, hasDrNumber: false }),
      ).toBe(ResolutionPath.NOT_APPLICABLE);
    });

    it('returns NOT_APPLICABLE for HSE incidents', () => {
      expect(
        classifyResolutionPath({ ticket_category: 'hse_incident', hasDrNumber: false }),
      ).toBe(ResolutionPath.NOT_APPLICABLE);
    });

    it('returns NOT_APPLICABLE for HSE near miss', () => {
      expect(
        classifyResolutionPath({ ticket_category: 'hse_near_miss', hasDrNumber: false }),
      ).toBe(ResolutionPath.NOT_APPLICABLE);
    });

    it('returns NOT_APPLICABLE for sales leads', () => {
      expect(
        classifyResolutionPath({ ticket_category: 'sales_lead', hasDrNumber: false }),
      ).toBe(ResolutionPath.NOT_APPLICABLE);
    });
  });

  describe('detection signals (highest precedence)', () => {
    it('returns FIX_SERIAL when serial mismatch detected', () => {
      expect(
        classifyResolutionPath({
          ticket_category: 'pre_provision',
          hasDrNumber: true,
          detection: { inOes: true, inOneMap: true, serialMismatch: true },
        }),
      ).toBe(ResolutionPath.FIX_SERIAL);
    });

    it('returns FIX_PROJECT_TAG when project mismatch detected', () => {
      expect(
        classifyResolutionPath({
          ticket_category: 'pre_provision',
          hasDrNumber: true,
          detection: { projectMismatch: true },
        }),
      ).toBe(ResolutionPath.FIX_PROJECT_TAG);
    });

    it('returns INVESTIGATE_DATA_GAP when DR is in OES but not 1Map', () => {
      expect(
        classifyResolutionPath({
          ticket_category: 'pre_provision',
          hasDrNumber: true,
          detection: { inOes: true, inOneMap: false },
        }),
      ).toBe(ResolutionPath.INVESTIGATE_DATA_GAP);
    });

    it('returns DISPATCH_SIGNUP when DR absent from all sources', () => {
      expect(
        classifyResolutionPath({
          ticket_category: 'pre_provision',
          hasDrNumber: false,
          detection: { inOes: false, inOneMap: false },
        }),
      ).toBe(ResolutionPath.DISPATCH_SIGNUP);
    });

    it('returns DISPATCH_INSTALL when sign-up done but install not done', () => {
      expect(
        classifyResolutionPath({
          ticket_category: 'pre_provision',
          hasDrNumber: false,
          detection: { signupDone: true, installDone: false },
        }),
      ).toBe(ResolutionPath.DISPATCH_INSTALL);
    });

    it('returns DISPATCH_SIGNUP when signupDone is explicitly false', () => {
      expect(
        classifyResolutionPath({
          ticket_category: 'pre_provision',
          hasDrNumber: false,
          detection: { signupDone: false },
        }),
      ).toBe(ResolutionPath.DISPATCH_SIGNUP);
    });
  });

  describe('category heuristic', () => {
    const categoryCases: Array<[string, ResolutionPath]> = [
      ['snag', ResolutionPath.SNAG],
      ['internal_snag', ResolutionPath.SNAG],
      ['home_signup_not_done', ResolutionPath.DISPATCH_SIGNUP],
      ['ont_swap', ResolutionPath.FIX_SERIAL],
      ['new_installation', ResolutionPath.INSTALL],
      ['fault_repair', ResolutionPath.MAINTENANCE],
      ['modification', ResolutionPath.MAINTENANCE],
      ['maintenance', ResolutionPath.MAINTENANCE],
    ];
    it.each(categoryCases)('maps category %s → %s', (category, expected) => {
      expect(
        classifyResolutionPath({ ticket_category: category, hasDrNumber: true }),
      ).toBe(expected);
    });

    it('PP with a DR → INVESTIGATE_DATA_GAP', () => {
      expect(
        classifyResolutionPath({ ticket_category: 'pre_provision', hasDrNumber: true }),
      ).toBe(ResolutionPath.INVESTIGATE_DATA_GAP);
    });

    it('PP without a DR → TRIAGE_REQUIRED (the screenshot case)', () => {
      expect(
        classifyResolutionPath({ ticket_category: 'pre_provision', hasDrNumber: false }),
      ).toBe(ResolutionPath.TRIAGE_REQUIRED);
    });
  });

  describe('discipline fallback when category missing', () => {
    it('civils discipline → SNAG', () => {
      expect(
        classifyResolutionPath({ ticket_type: TicketType.CIVILS, hasDrNumber: false }),
      ).toBe(ResolutionPath.SNAG);
    });

    it('optical discipline → SNAG', () => {
      expect(
        classifyResolutionPath({ ticket_type: TicketType.OPTICAL, hasDrNumber: false }),
      ).toBe(ResolutionPath.SNAG);
    });

    it('maintenance discipline → MAINTENANCE', () => {
      expect(
        classifyResolutionPath({ ticket_type: TicketType.MAINTENANCE, hasDrNumber: true }),
      ).toBe(ResolutionPath.MAINTENANCE);
    });

    it('activations discipline with DR → INSTALL', () => {
      expect(
        classifyResolutionPath({ ticket_type: TicketType.ACTIVATIONS, hasDrNumber: true }),
      ).toBe(ResolutionPath.INSTALL);
    });

    it('activations discipline without DR → TRIAGE_REQUIRED', () => {
      expect(
        classifyResolutionPath({ ticket_type: TicketType.ACTIVATIONS, hasDrNumber: false }),
      ).toBe(ResolutionPath.TRIAGE_REQUIRED);
    });
  });

  describe('safe default', () => {
    it('unspecified everything → TRIAGE_REQUIRED', () => {
      expect(classifyResolutionPath({ hasDrNumber: false })).toBe(ResolutionPath.TRIAGE_REQUIRED);
    });

    it('unknown category → TRIAGE_REQUIRED', () => {
      expect(
        classifyResolutionPath({ ticket_category: 'something_new', hasDrNumber: false }),
      ).toBe(ResolutionPath.TRIAGE_REQUIRED);
    });
  });
});

describe('isResolutionPath', () => {
  it('returns true for valid enum values', () => {
    expect(isResolutionPath('triage_required')).toBe(true);
    expect(isResolutionPath('install')).toBe(true);
  });

  it('returns false for unknown strings', () => {
    expect(isResolutionPath('made_up')).toBe(false);
    expect(isResolutionPath(null)).toBe(false);
    expect(isResolutionPath(42)).toBe(false);
  });
});
