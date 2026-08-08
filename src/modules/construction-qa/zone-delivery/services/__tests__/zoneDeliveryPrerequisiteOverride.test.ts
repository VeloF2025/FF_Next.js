import { describe, expect, it } from 'vitest';

import type { DeliveryActor } from '../../types/zoneDelivery.types';
import { requirePrerequisiteOverride, ZoneDeliveryError } from '../zoneDeliveryErrors';

const actor = (over: Partial<DeliveryActor> = {}): DeliveryActor => ({
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'operator@velocityfibre.co.za',
  permission: 'construction-qa.zone-delivery.operations-confirm',
  ...over,
});

describe('requirePrerequisiteOverride', () => {
  it('is not applied when the request does not ask for it', () => {
    expect(requirePrerequisiteOverride({}, actor({ canOverridePrerequisites: true }))).toBe(false);
  });

  it('applies when requested by a permitted actor with a reason', () => {
    const applied = requirePrerequisiteOverride(
      { overridePrerequisite: true, reason: 'Lawley zone 17 handed over before FibreFlow tracked the site' },
      actor({ canOverridePrerequisites: true }),
    );
    expect(applied).toBe(true);
  });

  it('refuses an actor without the override grant', () => {
    expect(() => requirePrerequisiteOverride(
      { overridePrerequisite: true, reason: 'legacy site' },
      actor({ canOverridePrerequisites: false }),
    )).toThrow(ZoneDeliveryError);
  });

  it('refuses when the grant is merely absent — fails closed, not open', () => {
    // The flag is optional; an actor built without it must not be treated as
    // permitted just because the property is undefined.
    expect(() => requirePrerequisiteOverride(
      { overridePrerequisite: true, reason: 'legacy site' },
      actor(),
    )).toThrow(/override is required/);
  });

  it('refuses a permitted actor who supplies no reason', () => {
    expect(() => requirePrerequisiteOverride(
      { overridePrerequisite: true },
      actor({ canOverridePrerequisites: true }),
    )).toThrow(/reason is required/);
  });

  it('refuses a whitespace-only reason', () => {
    expect(() => requirePrerequisiteOverride(
      { overridePrerequisite: true, reason: '   ' },
      actor({ canOverridePrerequisites: true }),
    )).toThrow(/reason is required/);
  });

  it('checks authority before reason, so an unauthorised actor cannot probe', () => {
    // Both are wrong here; the permission error must win.
    expect(() => requirePrerequisiteOverride(
      { overridePrerequisite: true },
      actor({ canOverridePrerequisites: false }),
    )).toThrow(/override is required/);
  });
});
