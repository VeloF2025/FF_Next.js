import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  claim: vi.fn(),
  release: vi.fn(),
  sql: vi.fn(),
  email: vi.fn(),
  whatsapp: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ sql: state.sql }));
vi.mock('../notificationIdempotency', () => ({
  claimNotification: state.claim,
  releaseNotificationClaim: state.release,
}));
vi.mock('../emailDelivery', () => ({ deliverEmail: state.email }));
vi.mock('../whatsappDelivery', () => ({ deliverWhatsApp: state.whatsapp }));
vi.mock('../../constants', () => ({
  DEFAULT_CHANNEL_PREFERENCES: { test: { in_app: true, email: true, whatsapp: true } },
  EVENT_ICONS: {}, EVENT_SEVERITY: {},
}));

import { notify } from '../notificationBus';

const payload = {
  event_type: 'test', title: 'Test', recipient_user_ids: ['user-1', 'user-2'],
  idempotency_key: 'stable-key',
};

describe('notification bus idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.claim.mockResolvedValue(true);
    state.release.mockResolvedValue(undefined);
    state.sql.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join('').includes('notification_preferences') ? [] : [{ id: 'notification-1' }]);
    state.email.mockResolvedValue(undefined);
    state.whatsapp.mockResolvedValue(undefined);
  });

  it('claims once per recipient when idempotency_key is present', async () => {
    expect(await notify(payload)).toEqual({ delivered: 2, suppressed: 0, failed: 0 });
    expect(state.claim).toHaveBeenCalledTimes(2);
  });

  it('skips every channel when the recipient claim already exists', async () => {
    state.claim.mockResolvedValue(false);
    expect(await notify({ ...payload, recipient_user_ids: ['user-1'] })).toEqual({ delivered: 0, suppressed: 1, failed: 0 });
    expect(state.email).not.toHaveBeenCalled();
    expect(state.whatsapp).not.toHaveBeenCalled();
    expect(state.sql).not.toHaveBeenCalled();
  });

  it('dispatches normally without an idempotency_key', async () => {
    expect(await notify({ ...payload, idempotency_key: undefined })).toEqual({ delivered: 2, suppressed: 0, failed: 0 });
    expect(state.claim).not.toHaveBeenCalled();
  });

  it('does not dispatch when the claim query throws', async () => {
    state.claim.mockRejectedValue(new Error('db unavailable'));
    expect(await notify({ ...payload, recipient_user_ids: ['user-1'] })).toEqual({ delivered: 0, suppressed: 0, failed: 1 });
    expect(state.sql).not.toHaveBeenCalled();
  });

  it('allows one recipient while suppressing another', async () => {
    state.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await notify(payload)).toEqual({ delivered: 1, suppressed: 1, failed: 0 });
  });

  it('releases a successful claim when durable in-app insertion fails', async () => {
    state.sql.mockImplementation(async (strings: TemplateStringsArray) => {
      if (strings.join('').includes('notification_preferences')) return [];
      throw new Error('insert unavailable');
    });

    expect(await notify({ ...payload, recipient_user_ids: ['user-1'] })).toEqual({
      delivered: 0,
      suppressed: 0,
      failed: 1,
    });
    expect(state.release).toHaveBeenCalledWith('user-1', 'test', 'stable-key');
  });

  // The interaction between the two things merged here, which neither side
  // covered on its own: a claim IS taken, then every channel turns out to be
  // muted. The previous idempotency work counted this recipient as `accepted`,
  // so it reported the notification as reached; master's rule counts only what
  // was dispatched, so it is now reported as nothing at all.
  it('reports a claimed but fully muted recipient as neither delivered nor failed', async () => {
    state.sql.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join('').includes('notification_preferences')
        ? [{ channel_in_app: false, channel_email: false, channel_whatsapp: false }]
        : [{ id: 'notification-1' }]);

    expect(await notify({ ...payload, recipient_user_ids: ['user-1'] })).toEqual({
      delivered: 0,
      suppressed: 0,
      failed: 0,
    });
    // Positive pins on WHY it is all zeroes: the claim was taken (so this is the
    // muted path, not the suppressed path), nothing was dispatched on either
    // async channel, and the claim is deliberately NOT released — a retry would
    // send nothing either, so consuming the key is correct.
    expect(state.claim).toHaveBeenCalledWith('user-1', 'test', 'stable-key');
    expect(state.email).not.toHaveBeenCalled();
    expect(state.whatsapp).not.toHaveBeenCalled();
    expect(state.release).not.toHaveBeenCalled();
  });
});
