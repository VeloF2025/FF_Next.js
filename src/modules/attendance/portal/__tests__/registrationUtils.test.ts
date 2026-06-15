import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

import { createSelfRegisteredFieldWorker } from '../registrationUtils';

beforeEach(() => { vi.clearAllMocks(); });

describe('createSelfRegisteredFieldWorker', () => {
  it('inserts a pending self_registered worker and returns the id', async () => {
    mocks.sql.mockResolvedValue([{ id: 'fw-1' }]);
    const id = await createSelfRegisteredFieldWorker({
      firstName: 'Thabo', lastName: 'M', phone: '+27821234567',
      role: 'technician', declaredProjectId: 'p1', idNumber: '9001015800087',
      selfieUrl: '/storage/registrations/x/selfie.jpg',
    });
    expect(id).toBe('fw-1');
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });
  it('throws if insert returns no id', async () => {
    // Both INSERT and fallback SELECT return nothing — should throw
    mocks.sql.mockResolvedValue([]);
    await expect(createSelfRegisteredFieldWorker({
      firstName: 'A', lastName: 'B', phone: '+27820000000', role: 'casual',
      declaredProjectId: 'p1', idNumber: null, selfieUrl: null,
    })).rejects.toThrow();
  });
  it('concurrent duplicate — INSERT returns [], SELECT returns existing id', async () => {
    // First call: INSERT ON CONFLICT DO NOTHING → no rows returned
    // Second call: fallback SELECT → existing row
    mocks.sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'existing' }]);
    const id = await createSelfRegisteredFieldWorker({
      firstName: 'Thabo', lastName: 'M', phone: '+27821234567', role: 'technician',
      declaredProjectId: 'p1', idNumber: null, selfieUrl: null,
    });
    expect(id).toBe('existing');
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });
});
