/**
 * Phase 4: Final Decision
 * PASS / FAIL / REWORK_NEEDED with reason codes and notes.
 */

'use client';

import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import type {
  Discipline,
  QaDecision,
  QaReasonCode,
  ChecklistStep,
} from '../../types';
import { REASON_CODE_LABELS } from '../../types/construction.types';

interface Props {
  review: { discipline: Discipline; vlm_confidence: number | null; [key: string]: unknown };
  checklist: readonly ChecklistStep[];
  checkedSteps: Record<string, boolean>;
  decision: QaDecision | null;
  reasonCodes: QaReasonCode[];
  notes: string;
  onDecisionChange: (d: QaDecision) => void;
  onReasonCodesChange: (codes: QaReasonCode[]) => void;
  onNotesChange: (n: string) => void;
}

const DECISIONS: { key: QaDecision; label: string; description: string; color: string; icon: typeof CheckCircle }[] = [
  {
    key: 'PASS',
    label: 'PASS',
    description: 'Feature meets all quality requirements',
    color: 'border-green-500 bg-green-500/10 text-green-400',
    icon: CheckCircle,
  },
  {
    key: 'REWORK_NEEDED',
    label: 'REWORK',
    description: 'Send back to field for corrections',
    color: 'border-orange-500 bg-orange-500/10 text-orange-400',
    icon: AlertTriangle,
  },
  {
    key: 'FAIL',
    label: 'FAIL',
    description: 'Feature fails quality standards permanently',
    color: 'border-red-500 bg-red-500/10 text-red-400',
    icon: XCircle,
  },
];

export function PhaseFinalDecision({
  review,
  checklist,
  checkedSteps,
  decision,
  reasonCodes,
  notes,
  onDecisionChange,
  onReasonCodesChange,
  onNotesChange,
}: Props) {
  // Count checked steps
  const totalSteps = checklist.length;
  const checkedCount = Object.values(checkedSteps).filter(Boolean).length;
  const requiredSteps = checklist.filter(s => s.required);
  const requiredCheckedCount = requiredSteps.filter(s => {
    const key = Object.keys(checkedSteps).find(k => k.includes(`_step_${String(s.step).padStart(2, '0')}_`));
    return key ? checkedSteps[key] : false;
  }).length;

  // Get reason codes for this discipline
  const disciplinePrefix = review.discipline.toUpperCase();
  const availableReasonCodes = Object.keys(REASON_CODE_LABELS)
    .filter(code => code.startsWith(disciplinePrefix)) as QaReasonCode[];

  const toggleReasonCode = (code: QaReasonCode) => {
    if (reasonCodes.includes(code)) {
      onReasonCodesChange(reasonCodes.filter(c => c !== code));
    } else {
      onReasonCodesChange([...reasonCodes, code]);
    }
  };

  // Auto-suggest decision based on checklist completion
  const suggestedDecision: QaDecision =
    requiredCheckedCount === requiredSteps.length && (review.vlm_confidence == null || Number(review.vlm_confidence) >= 0.6)
      ? 'PASS'
      : 'REWORK_NEEDED';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Final Decision</h2>
        <p className="text-sm text-gray-400">
          Make a final QA decision based on the photo review and data validation.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-3 bg-gray-900 rounded-lg text-center">
          <div className="text-2xl font-bold text-white">{checkedCount}/{totalSteps}</div>
          <div className="text-xs text-gray-500">Steps Checked</div>
        </div>
        <div className="p-3 bg-gray-900 rounded-lg text-center">
          <div className="text-2xl font-bold text-white">{requiredCheckedCount}/{requiredSteps.length}</div>
          <div className="text-xs text-gray-500">Required Steps</div>
        </div>
        <div className="p-3 bg-gray-900 rounded-lg text-center">
          <div className={`text-2xl font-bold ${
            review.vlm_confidence == null ? 'text-gray-500' :
            Number(review.vlm_confidence) >= 0.8 ? 'text-green-400' :
            Number(review.vlm_confidence) >= 0.6 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {review.vlm_confidence != null ? `${Math.round(Number(review.vlm_confidence) * 100)}%` : '—'}
          </div>
          <div className="text-xs text-gray-500">AI Confidence</div>
        </div>
      </div>

      {/* AI Suggestion */}
      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-sm text-blue-400">
          AI suggestion: <strong>{suggestedDecision}</strong> based on checklist completion and VLM confidence.
        </p>
      </div>

      {/* Decision Buttons */}
      <div className="grid grid-cols-3 gap-3">
        {DECISIONS.map(d => {
          const Icon = d.icon;
          const isSelected = decision === d.key;
          return (
            <button
              key={d.key}
              onClick={() => onDecisionChange(d.key)}
              className={`p-4 rounded-lg border-2 transition-all text-center ${
                isSelected ? d.color : 'border-[var(--border-color)] text-gray-500 hover:border-gray-500'
              }`}
            >
              <Icon className={`w-8 h-8 mx-auto mb-2 ${isSelected ? '' : 'opacity-50'}`} />
              <div className="text-lg font-bold">{d.label}</div>
              <div className="text-xs mt-1 opacity-75">{d.description}</div>
            </button>
          );
        })}
      </div>

      {/* Reason Codes (for FAIL / REWORK) */}
      {decision && decision !== 'PASS' && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-300">Reason Codes</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {availableReasonCodes.map(code => {
              const isSelected = reasonCodes.includes(code);
              return (
                <button
                  key={code}
                  onClick={() => toggleReasonCode(code)}
                  className={`text-left p-2 rounded border text-xs transition-colors ${
                    isSelected
                      ? 'border-red-500/50 bg-red-500/10 text-red-300'
                      : 'border-[var(--border-color)] text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-sm border ${isSelected ? 'bg-red-500 border-red-500' : 'border-gray-600'}`} />
                    <span>{REASON_CODE_LABELS[code]}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-300">
          Notes {decision && decision !== 'PASS' && <span className="text-red-400">*</span>}
        </label>
        <textarea
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          rows={4}
          className="w-full bg-gray-900 border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 resize-none"
          placeholder={decision === 'PASS' ? 'Optional notes...' : 'Required: Describe the issues found...'}
        />
      </div>
    </div>
  );
}
