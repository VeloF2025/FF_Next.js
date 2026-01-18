/**
 * Feedback Phase Component
 *
 * Phase 5 of QA Wizard - QA Summary and WhatsApp Feedback
 * - Shows comprehensive summary of the QA process
 * - Displays all findings from each phase
 * - Generates and sends WhatsApp feedback to technicians
 */

import React, { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import type { QaWizardState, QaDecision } from '../../types/unified.types';
import { getFailReasonDescription } from '../../services/qaAutoFailService';
import { STEP_LABELS } from '../../utils/stepMapper';

interface FeedbackPhaseProps {
  dropNumber: string;
  project?: string;
  wizardState: QaWizardState;
  onComplete: () => void;
  onBack: () => void;
}

interface FeedbackData {
  decision: QaDecision;
  reasons: string[];
  template: string;
  customMessage: string;
}

export function FeedbackPhase({
  dropNumber,
  project,
  wizardState,
  onComplete,
  onBack,
}: FeedbackPhaseProps) {
  const [feedback, setFeedback] = useState<FeedbackData>({
    decision: wizardState.finalDecision.decision || 'FAIL',
    reasons: wizardState.finalDecision.reasons || [],
    template: '',
    customMessage: '',
  });
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Generate feedback template on mount
  useEffect(() => {
    generateTemplate();
  }, [wizardState]);

  const generateTemplate = () => {
    const lines: string[] = [];
    const decision = wizardState.finalDecision.decision;

    // Header with decision
    if (decision === 'PASS') {
      lines.push(`*${dropNumber} - APPROVED*`);
      lines.push('');
    } else if (decision === 'FAIL') {
      lines.push(`*${dropNumber} - FAILED*`);
      lines.push('');
    } else {
      lines.push(`*${dropNumber} - REWORK NEEDED*`);
      lines.push('');
    }

    // Photo coverage summary
    const coveredSteps = 10 - (wizardState.photoReview.stepsMissing?.length || 0);
    lines.push(`*Photo Coverage:* ${coveredSteps}/10 steps`);

    if (wizardState.photoReview.stepsMissing?.length > 0) {
      const missingLabels = wizardState.photoReview.stepsMissing
        .map((s: number) => STEP_LABELS[s] || `Step ${s}`)
        .join(', ');
      lines.push(`Missing: ${missingLabels}`);
    }
    lines.push('');

    // Data validation results
    lines.push('*Validation Results:*');

    // Power meter
    const pm = wizardState.dataValidation.powerMeter;
    if (pm.value !== null) {
      const pmStatus = pm.inRange ? 'PASS' : 'FAIL';
      lines.push(`- Power Meter: ${pm.value} dBm (${pmStatus})`);
    }

    // ONT Serial validation
    const sv = wizardState.dataValidation.serialValidation;
    if (sv.ontMatch) {
      lines.push(`- ONT Serial: Verified`);
    } else if (sv.onemapSerial || sv.step6Serial || sv.step9Serial) {
      lines.push(`- ONT Serial: MISMATCH`);
      if (sv.onemapSerial) lines.push(`  1Map: ${sv.onemapSerial}`);
      if (sv.step6Serial) lines.push(`  Step 6: ${sv.step6Serial}`);
      if (sv.step9Serial) lines.push(`  Step 9: ${sv.step9Serial}`);
    }

    // DR Number validation
    if (sv.drMatch) {
      lines.push(`- DR Number: Verified`);
    } else if (sv.step9DrNumber) {
      lines.push(`- DR Number: MISMATCH (${sv.step9DrNumber})`);
    }

    lines.push('');

    // Issues found
    if (wizardState.finalDecision.reasons.length > 0) {
      lines.push('*Issues Found:*');
      wizardState.finalDecision.reasons.forEach((reason: string) => {
        lines.push(`- ${getFailReasonDescription(reason as any)}`);
      });
      lines.push('');
    }

    // Notes from QA reviewer
    if (wizardState.finalDecision.notes) {
      lines.push('*QA Notes:*');
      lines.push(wizardState.finalDecision.notes);
      lines.push('');
    }

    // Action required
    if (decision === 'FAIL') {
      lines.push('*Action Required:*');
      lines.push('Please address the issues above and resubmit.');
    } else if (decision === 'REWORK_NEEDED') {
      lines.push('*Action Required:*');
      lines.push('Minor corrections needed. Please fix and resubmit.');
    }

    setFeedback((prev) => ({
      ...prev,
      template: lines.join('\n'),
      customMessage: lines.join('\n'),
    }));
  };

  const handleSendFeedback = async () => {
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch('/api/activate/send-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dropNumber,
          project,
          decision: feedback.decision,
          message: feedback.customMessage,
          qaFindings: {
            photoCoverage: {
              covered: 10 - (wizardState.photoReview.stepsMissing?.length || 0),
              total: 10,
              missing: wizardState.photoReview.stepsMissing || [],
            },
            powerMeter: wizardState.dataValidation.powerMeter,
            serialValidation: wizardState.dataValidation.serialValidation,
            reasons: wizardState.finalDecision.reasons,
            notes: wizardState.finalDecision.notes,
          },
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSent(true);
        log.info('FeedbackPhase', `Feedback sent for ${dropNumber}`);
      } else {
        throw new Error(data.error || 'Failed to send feedback');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send feedback';
      setError(message);
      log.error('FeedbackPhase', `Error sending feedback: ${message}`);
    } finally {
      setIsSending(false);
    }
  };

  const getDecisionIcon = () => {
    switch (feedback.decision) {
      case 'PASS': return '✅';
      case 'FAIL': return '❌';
      case 'REWORK_NEEDED': return '⚠️';
      default: return '❓';
    }
  };

  const getDecisionColor = () => {
    switch (feedback.decision) {
      case 'PASS': return 'text-green-600 dark:text-green-400';
      case 'FAIL': return 'text-red-600 dark:text-red-400';
      case 'REWORK_NEEDED': return 'text-yellow-600 dark:text-yellow-400';
      default: return 'text-gray-600';
    }
  };

  const getDecisionBg = () => {
    switch (feedback.decision) {
      case 'PASS': return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      case 'FAIL': return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'REWORK_NEEDED': return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
      default: return 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700';
    }
  };

  // If feedback has been sent, show completion summary
  if (sent) {
    return (
      <div className="text-center py-8 space-y-6">
        <div className="text-6xl mb-4">{getDecisionIcon()}</div>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
          Review Complete
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          {dropNumber} has been reviewed and feedback sent to technicians.
        </p>

        <div className={`max-w-md mx-auto p-4 rounded-lg border ${getDecisionBg()}`}>
          <div className={`text-lg font-semibold ${getDecisionColor()}`}>
            Decision: {feedback.decision}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {feedback.reasons.length > 0
              ? `${feedback.reasons.length} issue(s) identified`
              : 'No issues found'}
          </div>
        </div>

        <button
          onClick={onComplete}
          className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          Finish Review
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Decision Header */}
      <div className={`p-4 rounded-lg border ${getDecisionBg()}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{getDecisionIcon()}</span>
            <div>
              <h3 className={`text-xl font-bold ${getDecisionColor()}`}>
                {feedback.decision}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {dropNumber} • {project || 'Unknown Project'}
              </p>
            </div>
          </div>
          <div className="text-right text-sm text-gray-500">
            {new Date().toLocaleDateString('en-ZA', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      </div>

      {/* QA Summary */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h4 className="font-semibold text-gray-900 dark:text-white mb-4">
          QA Summary
        </h4>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Prerequisites */}
          <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl mb-1">
              {wizardState.prerequisites.passed ? '✅' : '❌'}
            </div>
            <div className="text-sm font-medium">Prerequisites</div>
            <div className="text-xs text-gray-500">
              {wizardState.prerequisites.photoCount} photos
            </div>
          </div>

          {/* Photo Coverage */}
          <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl mb-1">
              {wizardState.photoReview.stepsMissing?.length === 0 ? '✅' : '⚠️'}
            </div>
            <div className="text-sm font-medium">Photo Coverage</div>
            <div className="text-xs text-gray-500">
              {10 - (wizardState.photoReview.stepsMissing?.length || 0)}/10 steps
            </div>
          </div>

          {/* Power Meter */}
          <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl mb-1">
              {wizardState.dataValidation.powerMeter.inRange ? '✅' : '❌'}
            </div>
            <div className="text-sm font-medium">Power Meter</div>
            <div className="text-xs text-gray-500">
              {wizardState.dataValidation.powerMeter.value ?? 'N/A'} dBm
            </div>
          </div>

          {/* Serial Check */}
          <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl mb-1">
              {wizardState.dataValidation.serialValidation.ontMatch ? '✅' : '❌'}
            </div>
            <div className="text-sm font-medium">Serial Check</div>
            <div className="text-xs text-gray-500">
              3-way validation
            </div>
          </div>
        </div>

        {/* Issues Found */}
        {feedback.reasons.length > 0 && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <div className="font-medium text-red-700 dark:text-red-300 mb-2">
              Issues Found ({feedback.reasons.length})
            </div>
            <ul className="space-y-1">
              {feedback.reasons.map((reason, idx) => (
                <li key={idx} className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                  <span>•</span>
                  {getFailReasonDescription(reason as any)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* WhatsApp Message */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="text-green-500">💬</span>
            WhatsApp Feedback
          </h4>
          <button
            type="button"
            onClick={generateTemplate}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Reset to Template
          </button>
        </div>

        <textarea
          value={feedback.customMessage}
          onChange={(e) => setFeedback((prev) => ({ ...prev, customMessage: e.target.value }))}
          rows={12}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-900 font-mono text-sm resize-none"
          placeholder="Feedback message to technician..."
        />

        <p className="text-xs text-gray-500 mt-2">
          This message will be sent to the project WhatsApp group.
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          ← Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={onComplete}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Skip Feedback
          </button>
          <button
            onClick={handleSendFeedback}
            disabled={isSending || !feedback.customMessage.trim()}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSending ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Sending...
              </>
            ) : (
              <>
                <span>📤</span>
                Send Feedback
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
