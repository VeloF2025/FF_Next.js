/**
 * H&S Audit Wizard Component
 *
 * Step-by-step audit form for conducting H&S audits.
 * Groups checklist items by category and allows pass/fail/na responses.
 */

import React, { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import {
  CheckCircle,
  XCircle,
  MinusCircle,
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Save,
  Send,
  MessageSquare,
  Info,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { formatDisplayDate } from '@/utils/dateFormat';
import type { ResponseValue, RAGStatus } from '../types/audit.types';
import { CHECKLIST_CATEGORIES } from '../types/checklist.types';

interface AuditWizardProps {
  auditId: string;
  onComplete?: (score: number, ragStatus: RAGStatus) => void;
  onCancel?: () => void;
}

interface AuditResponse {
  id: string;
  checklist_item_id: string;
  response: ResponseValue;
  notes?: string;
  photo_url?: string;
  corrective_action_required?: boolean;
  item_text: string;
  category: string;
  severity: string;
  regulation_reference?: string;
  is_mandatory: boolean;
  requires_photo: boolean;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function AuditWizard({ auditId, onComplete, onCancel }: AuditWizardProps) {
  const [currentCategory, setCurrentCategory] = useState(0);
  const [responses, setResponses] = useState<Record<string, Partial<AuditResponse>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch audit data
  const { data: auditData, error, mutate } = useSWR(
    `/api/health-safety/audits/${auditId}`,
    fetcher
  );

  const audit = auditData?.data?.audit;
  const serverResponses = (auditData?.data?.responses || []) as AuditResponse[];
  const byCategory = auditData?.data?.by_category || {};
  const summary = auditData?.data?.summary;

  // Get ordered categories
  const categories = useMemo(() => {
    return Object.keys(byCategory).sort((a, b) => {
      const aOrder = Object.keys(CHECKLIST_CATEGORIES).indexOf(a);
      const bOrder = Object.keys(CHECKLIST_CATEGORIES).indexOf(b);
      return aOrder - bOrder;
    });
  }, [byCategory]);

  // Merge local changes with server data
  const mergedResponses = useMemo(() => {
    const merged: Record<string, AuditResponse> = {};
    for (const r of serverResponses) {
      merged[r.id] = { ...r, ...responses[r.id] };
    }
    return merged;
  }, [serverResponses, responses]);

  // Get current category items
  const currentItems = useMemo(() => {
    if (!categories[currentCategory]) return [];
    const cat = byCategory[categories[currentCategory]];
    return cat?.items?.map((item: AuditResponse) => mergedResponses[item.id] || item) || [];
  }, [categories, currentCategory, byCategory, mergedResponses]);

  // Calculate progress
  const progress = useMemo(() => {
    const total = serverResponses.length;
    const answered = Object.values(mergedResponses).filter(
      (r) => r.response && r.response !== 'not_checked'
    ).length;
    return { total, answered, percentage: total > 0 ? Math.round((answered / total) * 100) : 0 };
  }, [serverResponses, mergedResponses]);

  // Handle response change
  const handleResponse = useCallback((itemId: string, value: ResponseValue) => {
    setResponses((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], response: value },
    }));
  }, []);

  // Handle notes change
  const handleNotes = useCallback((itemId: string, notes: string) => {
    setResponses((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], notes },
    }));
  }, []);

  // Handle corrective action toggle
  const handleCA = useCallback((itemId: string, required: boolean) => {
    setResponses((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], corrective_action_required: required },
    }));
  }, []);

  // Handle photo upload for audit item
  const handlePhotoUpload = useCallback(async (itemId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'health-safety');
        formData.append('category', 'audits');
        const res = await fetch('/api/storage/upload', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        const url = data.data?.url || data.url;
        setResponses((prev) => ({
          ...prev,
          [itemId]: { ...prev[itemId], photo_url: url },
        }));
      } catch (err) {
        log.error('Photo upload failed', { error: err }, 'AuditWizard');
      }
    };
    input.click();
  }, []);

  // Save progress
  const saveProgress = useCallback(async () => {
    setIsSaving(true);
    try {
      const updates = Object.entries(responses).map(([id, data]) => ({
        id,
        ...data,
      }));

      await fetch(`/api/health-safety/audits/${auditId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: updates }),
      });

      mutate();
      setResponses({});
    } catch (err) {
      log.error('Failed to save audit responses', { error: err }, 'AuditWizard');
    } finally {
      setIsSaving(false);
    }
  }, [auditId, responses, mutate]);

  // Complete audit
  const completeAudit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // Save any pending changes first
      const updates = Object.entries(responses).map(([id, data]) => ({
        id,
        ...data,
      }));

      const res = await fetch(`/api/health-safety/audits/${auditId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: updates, complete: true }),
      });

      if (res.ok) {
        const data = await res.json();
        onComplete?.(data.data.overall_score, data.data.rag_status);
      }
    } catch (err) {
      log.error('Failed to complete audit', { error: err }, 'AuditWizard');
    } finally {
      setIsSubmitting(false);
    }
  }, [auditId, responses, onComplete]);

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <p className="text-red-600">Failed to load audit data</p>
      </div>
    );
  }

  if (!auditData) {
    return (
      <div className="p-8 text-center">
        <LoadingSpinner size="xl" label="" className="mb-4" />
        <p className="text-muted-foreground">Loading audit...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {audit?.audit_type?.charAt(0).toUpperCase() + audit?.audit_type?.slice(1)} Audit
            </h2>
            <p className="text-sm text-muted-foreground">
              {audit?.project_name} • {formatDisplayDate(audit?.audit_date)}
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Progress indicator */}
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Progress</p>
              <p className="text-lg font-semibold text-foreground">
                {progress.answered}/{progress.total} ({progress.percentage}%)
              </p>
            </div>

            {/* Save button */}
            <button
              onClick={saveProgress}
              disabled={isSaving || Object.keys(responses).length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary dark:hover:bg-gray-600 text-foreground rounded-lg disabled:opacity-50 transition-colors"
            >
              {isSaving ? <InlineSpinner size="sm" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
          {categories.map((cat, idx) => {
            const catData = byCategory[cat];
            const catResponses = catData?.items?.map((i: any) => mergedResponses[i.id]) || [];
            const hasFailures = catResponses.some((r: any) => r?.response === 'fail');
            const isComplete = catResponses.every((r: any) => r?.response && r.response !== 'not_checked');

            return (
              <button
                key={cat}
                onClick={() => setCurrentCategory(idx)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  currentCategory === idx
                    ? 'bg-orange-500 text-white'
                    : 'bg-secondary text-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {CHECKLIST_CATEGORIES[cat as keyof typeof CHECKLIST_CATEGORIES]?.label || cat}
                {hasFailures && <XCircle className="w-4 h-4 text-red-400" />}
                {isComplete && !hasFailures && <CheckCircle className="w-4 h-4 text-green-400" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          {currentItems.map((item: AuditResponse) => (
            <ChecklistItemCard
              key={item.id}
              item={item}
              onResponse={(v) => handleResponse(item.id, v)}
              onNotes={(n) => handleNotes(item.id, n)}
              onCA={(r) => handleCA(item.id, r)}
              onPhoto={() => handlePhotoUpload(item.id)}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 bg-card border-t border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentCategory((c) => Math.max(0, c - 1))}
              disabled={currentCategory === 0}
              className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary dark:hover:bg-gray-600 text-foreground rounded-lg disabled:opacity-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>

            <button
              onClick={() => setCurrentCategory((c) => Math.min(categories.length - 1, c + 1))}
              disabled={currentCategory === categories.length - 1}
              className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary dark:hover:bg-gray-600 text-foreground rounded-lg disabled:opacity-50 transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2">
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-muted-foreground hover:text-gray-800 dark:hover:text-gray-200"
              >
                Cancel
              </button>
            )}

            <button
              onClick={completeAudit}
              disabled={isSubmitting || progress.percentage < 100}
              className="flex items-center gap-2 px-6 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? (
                <InlineSpinner size="sm" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Complete Audit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Checklist Item Card
function ChecklistItemCard({
  item,
  onResponse,
  onNotes,
  onCA,
  onPhoto,
}: {
  item: AuditResponse;
  onResponse: (value: ResponseValue) => void;
  onNotes: (notes: string) => void;
  onCA: (required: boolean) => void;
  onPhoto: () => void;
}) {
  const [showNotes, setShowNotes] = useState(!!item.notes);

  const severityColors = {
    critical: 'border-red-500 bg-red-50 dark:bg-red-900/10',
    high: 'border-orange-500 bg-orange-50 dark:bg-orange-900/10',
    medium: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10',
    low: 'border-border bg-secondary/50',
  };

  return (
    <div
      className={`border-l-4 rounded-lg p-4 ${
        severityColors[item.severity as keyof typeof severityColors] || severityColors.medium
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {item.is_mandatory && (
              <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded">
                Required
              </span>
            )}
            <span className="text-xs text-muted-foreground capitalize">
              {item.severity} severity
            </span>
          </div>

          <p className="text-foreground font-medium">{item.item_text}</p>

          {item.regulation_reference && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Info className="w-3 h-3" />
              {item.regulation_reference}
            </p>
          )}
        </div>

        {/* Response buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onResponse('pass')}
            className={`p-2 rounded-lg transition-colors ${
              item.response === 'pass'
                ? 'bg-green-500 text-white'
                : 'bg-secondary text-muted-foreground hover:bg-green-100 hover:text-green-600'
            }`}
            title="Pass"
          >
            <CheckCircle className="w-6 h-6" />
          </button>

          <button
            onClick={() => onResponse('fail')}
            className={`p-2 rounded-lg transition-colors ${
              item.response === 'fail'
                ? 'bg-red-500 text-white'
                : 'bg-secondary text-muted-foreground hover:bg-red-100 hover:text-red-600'
            }`}
            title="Fail"
          >
            <XCircle className="w-6 h-6" />
          </button>

          <button
            onClick={() => onResponse('na')}
            className={`p-2 rounded-lg transition-colors ${
              item.response === 'na'
                ? 'bg-gray-500 text-white'
                : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
            title="Not Applicable"
          >
            <MinusCircle className="w-6 h-6" />
          </button>

          {/* Photo upload */}
          <button
            onClick={onPhoto}
            className={`p-2 rounded-lg transition-colors ${
              item.photo_url
                ? 'bg-blue-500 text-white'
                : item.requires_photo
                  ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
            title={item.photo_url ? 'Photo attached — click to replace' : item.requires_photo ? 'Photo required — click to upload' : 'Add photo'}
          >
            <Camera className="w-6 h-6" />
          </button>

          {/* Notes toggle */}
          <button
            onClick={() => setShowNotes(!showNotes)}
            className={`p-2 rounded-lg transition-colors ${
              showNotes || item.notes
                ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
            title="Add notes"
          >
            <MessageSquare className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Photo thumbnail */}
      {item.photo_url && (
        <div className="mt-2">
          <img
            src={item.photo_url}
            alt="Evidence"
            className="h-16 rounded border border-border object-cover cursor-pointer hover:opacity-80"
            onClick={() => window.open(item.photo_url, '_blank')}
          />
        </div>
      )}

      {/* Notes section */}
      {showNotes && (
        <div className="mt-3 space-y-2">
          <textarea
            value={item.notes || ''}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="Add notes or observations..."
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-card text-foreground resize-none"
            rows={2}
          />

          {/* Corrective action checkbox (only for failures) */}
          {item.response === 'fail' && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={item.corrective_action_required || false}
                onChange={(e) => onCA(e.target.checked)}
                className="rounded border-border text-orange-500 focus:ring-orange-500"
              />
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Requires corrective action
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export default AuditWizard;
