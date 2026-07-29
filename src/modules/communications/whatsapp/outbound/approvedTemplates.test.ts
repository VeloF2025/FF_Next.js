import { describe, it, expect } from 'vitest';
import { describeTemplateArityProblems } from '@/modules/communications/whatsapp/outbound/approvedTemplates';
describe('template definitions', () => {
  it('has no placeholder/variable arity mismatch', () => {
    expect(describeTemplateArityProblems()).toEqual([]);
  });
});
