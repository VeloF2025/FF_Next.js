/**
 * State + side effects for the combined-PDF importer.
 *
 * Lifts everything that was inline in `CombinedPdfTab` so the component
 * tree underneath becomes pure presentational components driven by props.
 */

import React from 'react';

import type { CombinedImportResponse as CombinedPreview } from '@/modules/payslips/types';

import type {
  CasualDraft,
  ManualMapping,
  PlanCounts,
  Resolution,
  SkipDraft,
  UseCombinedImportApi,
} from '../types';

export function useCombinedImport(): UseCombinedImportApi {
  const [pdfFile, setPdfFileState] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<CombinedPreview | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [manualByPage, setManualByPage] = React.useState<Map<number, ManualMapping>>(
    new Map()
  );
  const [casualByPage, setCasualByPage] = React.useState<Map<number, CasualDraft>>(
    new Map()
  );
  const [skipByPage, setSkipByPage] = React.useState<Map<number, SkipDraft>>(new Map());
  const [forceReimport, setForceReimport] = React.useState(false);

  const resolutionByPage = React.useMemo(() => {
    const map = new Map<number, Resolution>();
    if (!preview) return map;
    for (const row of preview.pages) {
      if (skipByPage.has(row.page)) {
        map.set(row.page, { kind: 'skip' });
      } else if (casualByPage.has(row.page)) {
        map.set(row.page, { kind: 'casual' });
      } else {
        const manual = manualByPage.get(row.page);
        const staffId = manual?.staffId ?? row.match.staffId;
        map.set(row.page, staffId ? { kind: 'match', staffId } : null);
      }
    }
    return map;
  }, [preview, manualByPage, casualByPage, skipByPage]);

  const allResolved = preview
    ? preview.pages.every((p) => resolutionByPage.get(p.page) !== null)
    : false;
  const unresolvedCount = preview
    ? preview.pages.filter((p) => resolutionByPage.get(p.page) === null).length
    : 0;

  const counts = React.useMemo<PlanCounts>(() => {
    if (!preview) return { newRows: 0, willUpdate: 0, willSkip: 0, willNoop: 0, willCreate: 0 };
    let newRows = 0;
    let willUpdate = 0;
    let willSkip = 0;
    let willNoop = 0;
    let willCreate = 0;
    for (const row of preview.pages) {
      const resolution = resolutionByPage.get(row.page);
      if (resolution?.kind === 'skip') {
        willSkip++;
        continue;
      }
      if (resolution?.kind === 'casual') {
        willCreate++;
        newRows++;
        continue;
      }
      if (!resolution) continue;
      if (forceReimport) {
        if (row.rowState === 'already_imported' || row.rowState === 'matched_changed') {
          willUpdate++;
        } else {
          newRows++;
        }
        continue;
      }
      if (row.rowState === 'already_imported') {
        willNoop++;
      } else if (row.rowState === 'matched_changed') {
        willUpdate++;
      } else {
        newRows++;
      }
    }
    return { newRows, willUpdate, willSkip, willNoop, willCreate };
  }, [preview, resolutionByPage, forceReimport]);

  const usedStaffIds = React.useMemo(() => {
    const set = new Set<string>();
    if (!preview) return set;
    for (const row of preview.pages) {
      const manual = manualByPage.get(row.page);
      const id = manual?.staffId ?? row.match.staffId;
      if (id) set.add(id);
    }
    return set;
  }, [preview, manualByPage]);

  const setPdfFile = (file: File | null) => {
    setPdfFileState(file);
    setPreview(null);
    setManualByPage(new Map());
    setCasualByPage(new Map());
    setSkipByPage(new Map());
    setForceReimport(false);
  };

  const submit = async (commit: boolean) => {
    if (!pdfFile) {
      setError('Pick the combined payslips PDF first.');
      return;
    }
    if (commit && !allResolved) {
      setError(`${unresolvedCount} row(s) still need a decision (map, create, or skip).`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      formData.append('commit', commit ? 'true' : 'false');
      formData.append('forceReimport', forceReimport ? 'true' : 'false');
      if (commit && manualByPage.size > 0) {
        formData.append(
          'manualMappings',
          JSON.stringify(Array.from(manualByPage.values()))
        );
      }
      if (commit && casualByPage.size > 0) {
        formData.append('casualCreates', JSON.stringify(Array.from(casualByPage.values())));
      }
      if (commit && skipByPage.size > 0) {
        formData.append('skipPages', JSON.stringify(Array.from(skipByPage.values())));
      }
      const res = await fetch('/api/staff/payslips/import-combined', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message ?? `Server returned HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      setPreview(json.data as CombinedPreview);
      if (!commit) {
        setManualByPage(new Map());
        setCasualByPage(new Map());
        setSkipByPage(new Map());
      }
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setSubmitting(false);
    }
  };

  const setMapping = (page: number, staffId: string | null, savePayrollCode: boolean) => {
    setManualByPage((prev) => {
      const next = new Map(prev);
      if (!staffId) {
        next.delete(page);
      } else {
        next.set(page, { page, staffId, savePayrollCode });
      }
      return next;
    });
    setCasualByPage((prev) => {
      if (!prev.has(page)) return prev;
      const next = new Map(prev);
      next.delete(page);
      return next;
    });
    setSkipByPage((prev) => {
      if (!prev.has(page)) return prev;
      const next = new Map(prev);
      next.delete(page);
      return next;
    });
  };

  const setCasualDraft = (page: number, draft: CasualDraft | null) => {
    setCasualByPage((prev) => {
      const next = new Map(prev);
      if (!draft) next.delete(page);
      else next.set(page, draft);
      return next;
    });
    if (draft) {
      setManualByPage((prev) => {
        if (!prev.has(page)) return prev;
        const next = new Map(prev);
        next.delete(page);
        return next;
      });
      setSkipByPage((prev) => {
        if (!prev.has(page)) return prev;
        const next = new Map(prev);
        next.delete(page);
        return next;
      });
    }
  };

  const toggleSkip = (page: number, reason?: string) => {
    setSkipByPage((prev) => {
      const next = new Map(prev);
      if (next.has(page)) {
        next.delete(page);
      } else {
        next.set(page, { page, reason: reason ?? '' });
      }
      return next;
    });
  };

  const skipAllUnmatched = () => {
    if (!preview) return;
    setSkipByPage((prev) => {
      const next = new Map(prev);
      for (const row of preview.pages) {
        const resolution = resolutionByPage.get(row.page);
        if (resolution === null || row.rowState === 'unmatched') {
          if (!next.has(row.page)) {
            next.set(row.page, { page: row.page, reason: 'Bulk-skipped on import' });
          }
        }
      }
      return next;
    });
  };

  return {
    pdfFile,
    preview,
    submitting,
    error,
    manualByPage,
    casualByPage,
    skipByPage,
    forceReimport,
    resolutionByPage,
    allResolved,
    unresolvedCount,
    counts,
    usedStaffIds,
    setPdfFile,
    setForceReimport,
    setMapping,
    setCasualDraft,
    toggleSkip,
    skipAllUnmatched,
    submit,
  };
}

