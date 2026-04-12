import { describe, it, expect } from 'vitest';
import type { VlmAnalysisType } from '@/types/vlm-learning';

describe('VlmAnalysisType', () => {
  it('includes wa_serial_recheck', () => {
    const type: VlmAnalysisType = 'wa_serial_recheck';
    expect(type).toBe('wa_serial_recheck');
  });
});
