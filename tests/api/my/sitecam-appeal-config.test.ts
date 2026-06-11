/**
 * Regression test: /api/my/sitecam/appeal body-size limit.
 *
 * The appeal POST carries the step photo as a base64 data URI (several MB).
 * Without an explicit bodyParser sizeLimit, Next.js rejects the request at
 * 1mb with a 413 before the handler runs — the PWA shows "Network error"
 * and the appeal is silently lost (reported 2026-06-11).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ default: { query: vi.fn() }, db: { query: vi.fn() } }));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession: (handler: unknown) => handler,
}));
vi.mock('@/modules/notifications/services/whatsappDelivery', () => ({
  sendWhatsAppGroup: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { config } from '../../../pages/api/my/sitecam/appeal';

describe('/api/my/sitecam/appeal route config', () => {
  it('raises the bodyParser limit to fit a base64 photo (default 1mb causes 413)', () => {
    expect(config.api.bodyParser.sizeLimit).toBe('15mb');
  });
});
