import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  claim: vi.fn(),
  sql: vi.fn(),
  email: vi.fn(),
  whatsapp: vi.fn(),
}));

vi.mock('@/lib/db-neon', () => ({ neon: () => state.sql }));
vi.mock('../notificationIdempotency', () => ({ claimNotification: state.claim }));
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
    state.sql.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join('').includes('notification_preferences') ? [] : [{ id: 'notification-1' }]);
    state.email.mockResolvedValue(undefined);
    state.whatsapp.mockResolvedValue(undefined);
  });

  it('claims once per recipient when idempotency_key is present', async () => {
    expect(await notify(payload)).toEqual({ accepted_recipients: 2, suppressed_recipients: 0, failed_recipients: 0 });
    expect(state.claim).toHaveBeenCalledTimes(2);
  });

  it('skips every channel when the recipient claim already exists', async () => {
    state.claim.mockResolvedValue(false);
    expect(await notify({ ...payload, recipient_user_ids: ['user-1'] })).toEqual({ accepted_recipients: 0, suppressed_recipients: 1, failed_recipients: 0 });
    expect(state.email).not.toHaveBeenCalled();
    expect(state.whatsapp).not.toHaveBeenCalled();
    expect(state.sql).not.toHaveBeenCalled();
  });

  it('dispatches normally without an idempotency_key', async () => {
    expect(await notify({ ...payload, idempotency_key: undefined })).toEqual({ accepted_recipients: 2, suppressed_recipients: 0, failed_recipients: 0 });
    expect(state.claim).not.toHaveBeenCalled();
  });

  it('does not dispatch when the claim query throws', async () => {
    state.claim.mockRejectedValue(new Error('db unavailable'));
    expect(await notify({ ...payload, recipient_user_ids: ['user-1'] })).toEqual({ accepted_recipients: 0, suppressed_recipients: 0, failed_recipients: 1 });
    expect(state.sql).not.toHaveBeenCalled();
  });

  it('allows one recipient while suppressing another', async () => {
    state.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await notify(payload)).toEqual({ accepted_recipients: 1, suppressed_recipients: 1, failed_recipients: 0 });
  });
});
