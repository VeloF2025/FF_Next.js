import { describe, it, expect } from 'vitest';
import {
  ANALYSIS_TYPES_BY_MODULE,
  type VlmAnalysisType,
  type VlmModule,
} from '@/types/vlm-learning';

describe('VlmAnalysisType', () => {
  it('includes wa_serial_recheck', () => {
    const type: VlmAnalysisType = 'wa_serial_recheck';
    expect(type).toBe('wa_serial_recheck');
  });

  it('exposes Works QA with isolated civil and optical learning lanes', () => {
    const module: VlmModule = 'works_qa';
    expect(ANALYSIS_TYPES_BY_MODULE[module]).toEqual([
      'works_qa_civil',
      'works_qa_optical',
    ]);
  });
});
