/**
 * Tests for useReportScopeForm
 *
 * Pure state hook — no DB, no fetch, no effects with side-effects.
 * renderHook + act from @testing-library/react drives the hook.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReportScopeForm } from '../useReportScopeForm';

describe('useReportScopeForm', () => {
  describe('default scope from URL context', () => {
    it('defaults to zone when only zone_no is in ctx', () => {
      const { result } = renderHook(() => useReportScopeForm({ zone_no: 24 }));
      expect(result.current.scope).toBe('zone');
      expect(result.current.zones).toEqual([24]);
      expect(result.current.pons).toEqual([]);
      expect(result.current.poles).toEqual([]);
    });

    it('defaults to pon when zone_no + pon_no in ctx', () => {
      const { result } = renderHook(() => useReportScopeForm({ zone_no: 24, pon_no: 265 }));
      expect(result.current.scope).toBe('pon');
      expect(result.current.zones).toEqual([24]);
      expect(result.current.pons).toEqual([265]);
    });

    it('defaults to pole when pole_id in ctx', () => {
      const { result } = renderHook(() => useReportScopeForm({ pole_id: 'LAW.P.X001' }));
      expect(result.current.scope).toBe('pole');
      expect(result.current.poles).toEqual(['LAW.P.X001']);
    });

    it('defaults to zone when ctx is empty (no URL context)', () => {
      const { result } = renderHook(() => useReportScopeForm({}));
      expect(result.current.scope).toBe('zone');
      expect(result.current.zones).toEqual([]);
    });
  });

  describe('validation', () => {
    it('blocks until projectId set', () => {
      const { result } = renderHook(() => useReportScopeForm({ zone_no: 24 }));
      expect(result.current.validate()).toMatch(/projectId|project_id/i);
    });

    it('requires non-empty poles[] when scope=pole', () => {
      const { result } = renderHook(() => useReportScopeForm({}));
      act(() => {
        result.current.setProjectId('p1');
        result.current.setScope('pole');
      });
      expect(result.current.validate()).toMatch(/poles/i);
    });

    it('requires non-empty pons[] when scope=pon', () => {
      const { result } = renderHook(() => useReportScopeForm({}));
      act(() => {
        result.current.setProjectId('p1');
        result.current.setScope('pon');
      });
      expect(result.current.validate()).toMatch(/pons/i);
    });

    it('rejects fromDate > toDate', () => {
      const { result } = renderHook(() => useReportScopeForm({ zone_no: 24 }));
      act(() => {
        result.current.setProjectId('p1');
        result.current.setFromDate('2026-06-01');
        result.current.setToDate('2026-05-01');
      });
      expect(result.current.validate()).toMatch(/from.*<=?\s*to|from.*to/i);
    });

    it('returns null when form is valid', () => {
      const { result } = renderHook(() => useReportScopeForm({ zone_no: 24 }));
      act(() => result.current.setProjectId('p1'));
      expect(result.current.validate()).toBeNull();
    });
  });

  describe('toSubmitBody', () => {
    it('produces the POST body shape', () => {
      const { result } = renderHook(() => useReportScopeForm({ zone_no: 24 }));
      act(() => result.current.setProjectId('p1'));
      const body = result.current.toSubmitBody();
      expect(body).toMatchObject({ project_id: 'p1', scope: 'zone', zones: [24] });
      expect(body.from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.to_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.severities).toEqual(['minor', 'major', 'critical']);
    });
  });

  describe('default date range', () => {
    it('is last 30 days in ISO YYYY-MM-DD', () => {
      const { result } = renderHook(() => useReportScopeForm({}));
      expect(result.current.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.current.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // From should be <= To
      expect(result.current.fromDate <= result.current.toDate).toBe(true);
    });
  });
});
