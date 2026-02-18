/**
 * Phase 1: Prerequisites
 * Verify photos exist, feature data is loaded, and VLM is ready.
 */

import { CheckCircle, XCircle, AlertTriangle, Camera, Database, Cpu } from 'lucide-react';
import type { ChecklistStep } from '../../types';

interface Props {
  review: Record<string, unknown>;
  photos: Array<{ checklist_step: number | null; [key: string]: unknown }>;
  checklist: readonly ChecklistStep[];
}

export function PhasePrerequisites({ review, photos, checklist }: Props) {
  const photoCount = photos.length;
  const requiredSteps = checklist.filter(s => s.required);
  const coveredSteps = new Set(photos.map(p => p.checklist_step).filter(Boolean));
  const missingRequired = requiredSteps.filter(s => !coveredSteps.has(s.step));
  const vlmStatus = review.vlm_status as string;
  const vlmReady = vlmStatus === 'completed';

  const checks = [
    {
      label: 'Photos available',
      description: `${photoCount} photo(s) loaded from source`,
      passed: photoCount > 0,
      icon: Camera,
    },
    {
      label: 'Required steps covered',
      description: missingRequired.length === 0
        ? `All ${requiredSteps.length} required steps have photos`
        : `Missing: ${missingRequired.map(s => `Step ${s.step} (${s.label})`).join(', ')}`,
      passed: missingRequired.length === 0,
      warning: missingRequired.length > 0 && photoCount > 0,
      icon: CheckCircle,
    },
    {
      label: 'Feature data loaded',
      description: review.feature_id ? `Feature: ${review.feature_id}` : 'No feature ID',
      passed: Boolean(review.feature_id),
      icon: Database,
    },
    {
      label: 'AI validation',
      description: vlmReady
        ? `VLM completed — ${review.vlm_confidence != null ? `${Math.round(Number(review.vlm_confidence) * 100)}% confidence` : 'no score'}`
        : vlmStatus === 'processing' ? 'VLM processing in progress...'
        : vlmStatus === 'failed' ? 'VLM processing failed — manual review required'
        : 'VLM not yet run — will process when triggered',
      passed: vlmReady,
      warning: vlmStatus === 'processing',
      icon: Cpu,
    },
  ];

  const allPassed = checks.every(c => c.passed);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Prerequisites Check</h2>
        <p className="text-sm text-gray-400">
          Verify that all required data is available before starting the review.
        </p>
      </div>

      <div className="space-y-3">
        {checks.map((check, i) => {
          const Icon = check.icon;
          const StatusIcon = check.passed ? CheckCircle : check.warning ? AlertTriangle : XCircle;
          const statusColor = check.passed ? 'text-green-400' : check.warning ? 'text-yellow-400' : 'text-red-400';
          const borderColor = check.passed ? 'border-green-500/30' : check.warning ? 'border-yellow-500/30' : 'border-red-500/30';

          return (
            <div
              key={i}
              className={`flex items-start gap-4 p-4 rounded-lg border ${borderColor} bg-[var(--card-bg)]`}
            >
              <Icon className={`w-5 h-5 mt-0.5 ${statusColor}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{check.label}</span>
                  <StatusIcon className={`w-4 h-4 ${statusColor}`} />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{check.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step coverage summary */}
      <div className="border-t border-[var(--border-color)] pt-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Checklist Step Coverage</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {checklist.map(step => {
            const hasCoverage = coveredSteps.has(step.step);
            return (
              <div
                key={step.step}
                className={`flex items-center gap-2 p-2 rounded text-xs ${
                  hasCoverage
                    ? 'bg-green-500/10 text-green-400'
                    : step.required
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-gray-500/10 text-gray-500'
                }`}
              >
                {hasCoverage ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                <span>S{step.step}: {step.label}</span>
                {!step.required && <span className="text-gray-600">(opt)</span>}
              </div>
            );
          })}
        </div>
      </div>

      {allPassed && (
        <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className="text-sm text-green-400 font-medium">
            All prerequisites met — proceed to Photo Review.
          </p>
        </div>
      )}

      {!allPassed && photoCount > 0 && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-sm text-yellow-400 font-medium">
            Some prerequisites are not met, but you can still proceed with manual review.
          </p>
        </div>
      )}
    </div>
  );
}
