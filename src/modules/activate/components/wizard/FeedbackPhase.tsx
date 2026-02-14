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
import {
  getTechnicianIssues,
  getTechnicianIssueDescription,
  detectSwappedSerials,
  formatSerialFeedback,
  maskSerial,
  getSerialStatus,
  type TechnicianIssue,
} from '../../services/qaAutoFailService';
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

type FeedbackDestination = 'group' | 'private' | 'both';

interface StaffOption {
  id: string;
  name: string;
  whatsappId: string | null;
  position: string | null;
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

  // Staff tagging and task creation
  const [availableStaff, setAvailableStaff] = useState<StaffOption[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [createTask, setCreateTask] = useState(
    wizardState.finalDecision.decision === 'FAIL' ||
    wizardState.finalDecision.decision === 'REWORK_NEEDED'
  );

  // Feedback destination options
  const [feedbackDestination, setFeedbackDestination] = useState<FeedbackDestination>('group');
  const [sendStaffPrivate, setSendStaffPrivate] = useState(false);
  const [hasTechnicianJid, setHasTechnicianJid] = useState(false);

  // Track if feedback was already sent
  const [feedbackAlreadySent, setFeedbackAlreadySent] = useState(false);
  const [feedbackSentAt, setFeedbackSentAt] = useState<string | null>(null);
  const [confirmResend, setConfirmResend] = useState(false);

  // Check if technician JID is available and if feedback was already sent
  useEffect(() => {
    const checkDrStatus = async () => {
      try {
        const response = await fetch(`/api/activate/${encodeURIComponent(dropNumber)}`);
        const data = await response.json();
        if (data.success && data.data) {
          if (data.data.wa_sender_jid) {
            setHasTechnicianJid(true);
          }
          // Check if feedback was already sent
          if (data.data.feedback_sent) {
            setFeedbackAlreadySent(true);
            setFeedbackSentAt(data.data.feedback_sent_at);
          }
        }
      } catch (err) {
        log.error('FeedbackPhase', 'Failed to check DR status:', err);
      }
    };
    checkDrStatus();
  }, [dropNumber]);

  // Fetch staff for project on mount
  useEffect(() => {
    if (project) {
      fetchStaffForProject(project);
    }
  }, [project]);

  const fetchStaffForProject = async (projectName: string) => {
    setLoadingStaff(true);
    try {
      const response = await fetch(`/api/activate/staff-by-project?project=${encodeURIComponent(projectName)}`);
      const data = await response.json();
      if (data.success && data.data?.staff) {
        setAvailableStaff(data.data.staff);
        log.info('FeedbackPhase', `Loaded ${data.data.staff.length} staff for ${projectName}`);
      }
    } catch (err) {
      log.error('FeedbackPhase', 'Failed to fetch staff:', err);
    } finally {
      setLoadingStaff(false);
    }
  };

  // Generate feedback template on mount
  useEffect(() => {
    generateTemplate();
  }, [wizardState]);

  const generateTemplate = () => {
    const lines: string[] = [];
    const decision = wizardState.finalDecision.decision;

    // Header with decision
    if (decision === 'PASS') {
      lines.push(`*${dropNumber} - APPROVED* ✅`);
      lines.push('');
    } else if (decision === 'FAIL') {
      lines.push(`*${dropNumber} - FAILED* ❌`);
      lines.push('');
    } else {
      lines.push(`*${dropNumber} - REWORK NEEDED* ⚠️`);
      lines.push('');
    }

    // Get technician-actionable issues (NOT internal VLM comparison data)
    const missingSteps = wizardState.photoReview.stepsMissing || [];
    const technicianIssues = getTechnicianIssues({
      ontSerial: wizardState.prerequisites.ontSerial,
      upsSerial: wizardState.prerequisites.upsSerial,
      photoCount: wizardState.photoReview.totalPhotos,
      missingSteps,
      powerMeterDbm: wizardState.dataValidation.powerMeter.value,
    });

    // Check for swapped serials - this is CRITICAL and shown prominently
    const swapCheck = detectSwappedSerials(
      wizardState.prerequisites.ontSerial,
      wizardState.prerequisites.upsSerial
    );

    if (swapCheck.swapped) {
      lines.push('🔴 *CRITICAL: SERIALS SWAPPED*');
      lines.push(swapCheck.details);
      lines.push('Please correct in 1Map immediately.');
      lines.push('');
    }

    // Photo coverage summary
    const coveredSteps = 10 - missingSteps.length;
    lines.push(`*Photo Coverage:* ${coveredSteps}/10 steps`);

    if (missingSteps.length > 0) {
      const missingLabels = missingSteps
        .map((s: number) => STEP_LABELS[s] || `Step ${s}`)
        .join(', ');
      lines.push(`*Missing Photos:* ${missingLabels}`);
    }
    lines.push('');

    // Validation results (technician-actionable only)
    lines.push('*Validation Results:*');

    // Power meter
    const pm = wizardState.dataValidation.powerMeter;
    if (pm.value !== null) {
      const pmStatus = pm.inRange ? '✓' : '✗';
      lines.push(`- Power Meter: ${pm.value} dBm ${pmStatus}`);
    }

    // Serial status with detailed feedback (shows partial serial, format validation)
    const serialFeedback = formatSerialFeedback(
      wizardState.prerequisites.ontSerial,
      wizardState.prerequisites.upsSerial
    );
    lines.push(serialFeedback.ontLine);
    lines.push(serialFeedback.upsLine);
    lines.push('');

    // Actionable issues for technician (excluding swap which is shown above)
    const actionableIssues = technicianIssues.filter(i => i.code !== 'SERIALS_SWAPPED');
    if (actionableIssues.length > 0) {
      lines.push('*Action Required:*');
      actionableIssues.forEach((issue) => {
        const icon = issue.severity === 'error' ? '❌' : '⚠️';
        lines.push(`${icon} ${getTechnicianIssueDescription(issue.code)}`);
      });
      lines.push('');
    }

    // Technician feedback from QA reviewer (NOT internal notes!)
    if (wizardState.finalDecision.technicianFeedback) {
      lines.push('*QA Feedback:*');
      lines.push(wizardState.finalDecision.technicianFeedback);
      lines.push('');
    }

    // Final action prompt
    if (decision === 'FAIL' || decision === 'REWORK_NEEDED') {
      if (actionableIssues.length > 0 || swapCheck.swapped) {
        lines.push('Please address the issues above and resubmit.');
      }
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
          destination: feedbackDestination, // 'group' | 'private' | 'both'
          staffId: selectedStaffId, // Staff to @mention in WhatsApp
          sendStaffPrivate, // Also send private copy to selected staff
          createTask, // Whether to create a follow-up task
          autoGenerate: feedbackAlreadySent, // Allow resending if feedback was already sent
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
        // API returns { success: false, error: { code, message } }
        const errorMsg = typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to send feedback';
        throw new Error(errorMsg);
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
      default: return 'text-gray-600 dark:text-gray-400';
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
          <div className="text-right text-sm text-gray-500 dark:text-gray-400">
            {new Date().toISOString().split('T')[0]} {new Date().toTimeString().slice(0, 5)}
          </div>
        </div>
      </div>

      {/* QA Summary */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h4 className="font-semibold text-gray-900 dark:text-white mb-4">
          QA Summary
        </h4>

        {/* Swapped serials warning - prominent display */}
        {(() => {
          const swapCheck = detectSwappedSerials(
            wizardState.prerequisites.ontSerial,
            wizardState.prerequisites.upsSerial
          );
          if (swapCheck.swapped) {
            return (
              <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-semibold mb-2">
                  <span className="text-xl">🔴</span>
                  SERIALS SWAPPED
                </div>
                <p className="text-sm text-red-600 dark:text-red-400">{swapCheck.details}</p>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  <div>ONT field: <code className="bg-white dark:bg-gray-800/50 px-1 rounded">{wizardState.prerequisites.ontSerial || 'N/A'}</code></div>
                  <div>UPS field: <code className="bg-white dark:bg-gray-800/50 px-1 rounded">{wizardState.prerequisites.upsSerial || 'N/A'}</code></div>
                </div>
              </div>
            );
          }
          return null;
        })()}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {/* Prerequisites */}
          <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl mb-1">
              {wizardState.prerequisites.passed ? '✅' : '❌'}
            </div>
            <div className="text-sm font-medium">Prerequisites</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {wizardState.prerequisites.photoCount} photos
            </div>
          </div>

          {/* Photo Coverage */}
          <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl mb-1">
              {wizardState.photoReview.stepsMissing?.length === 0 ? '✅' : '⚠️'}
            </div>
            <div className="text-sm font-medium">Photo Coverage</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {10 - (wizardState.photoReview.stepsMissing?.length || 0)}/10 steps
            </div>
          </div>

          {/* Power Meter */}
          <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl mb-1">
              {wizardState.dataValidation.powerMeter.inRange ? '✅' : '❌'}
            </div>
            <div className="text-sm font-medium">Power Meter</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {wizardState.dataValidation.powerMeter.value ?? 'N/A'} dBm
            </div>
          </div>

          {/* Serial Status - with detailed info */}
          <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl mb-1">
              {(() => {
                const ontStatus = getSerialStatus(wizardState.prerequisites.ontSerial, 'ont');
                const upsStatus = getSerialStatus(wizardState.prerequisites.upsSerial, 'ups');
                if (ontStatus.status === 'present_swapped' || upsStatus.status === 'present_swapped') return '🔴';
                if (ontStatus.status === 'present_valid' && upsStatus.status === 'present_valid') return '✅';
                if (ontStatus.status === 'present_invalid' || upsStatus.status === 'present_invalid') return '⚠️';
                return '❌';
              })()}
            </div>
            <div className="text-sm font-medium">Serials</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {(() => {
                const ontStatus = getSerialStatus(wizardState.prerequisites.ontSerial, 'ont');
                const upsStatus = getSerialStatus(wizardState.prerequisites.upsSerial, 'ups');
                if (ontStatus.status === 'present_swapped' || upsStatus.status === 'present_swapped') return 'SWAPPED';
                if (ontStatus.status === 'present_valid' && upsStatus.status === 'present_valid') return 'Both valid';
                if (ontStatus.status === 'missing' && upsStatus.status === 'missing') return 'None scanned';
                if (ontStatus.status === 'missing') return 'ONT missing';
                if (upsStatus.status === 'missing') return 'UPS missing';
                return 'Format issues';
              })()}
            </div>
          </div>
        </div>

        {/* Detailed Serial Status */}
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
          <div className="font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Serial Details</div>
          <div className="space-y-1 text-sm">
            {(() => {
              const ontStatus = getSerialStatus(wizardState.prerequisites.ontSerial, 'ont');
              const upsStatus = getSerialStatus(wizardState.prerequisites.upsSerial, 'ups');
              return (
                <>
                  <div className={`${ontStatus.status === 'present_valid' ? 'text-green-600 dark:text-green-400' : ontStatus.status === 'missing' ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                    ONT: {ontStatus.message}
                  </div>
                  <div className={`${upsStatus.status === 'present_valid' ? 'text-green-600 dark:text-green-400' : upsStatus.status === 'missing' ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                    UPS: {upsStatus.message}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* Technician-actionable issues */}
        {(() => {
          const techIssues = getTechnicianIssues({
            ontSerial: wizardState.prerequisites.ontSerial,
            upsSerial: wizardState.prerequisites.upsSerial,
            photoCount: wizardState.photoReview.totalPhotos,
            missingSteps: wizardState.photoReview.stepsMissing || [],
            powerMeterDbm: wizardState.dataValidation.powerMeter.value,
          });

          if (techIssues.length > 0) {
            return (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <div className="font-medium text-red-700 dark:text-red-300 mb-2">
                  Technician Action Required ({techIssues.length})
                </div>
                <ul className="space-y-1">
                  {techIssues.map((issue, idx) => (
                    <li key={idx} className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                      <span>{issue.severity === 'error' ? '❌' : '⚠️'}</span>
                      {getTechnicianIssueDescription(issue.code)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* Feedback Already Sent Warning */}
      {feedbackAlreadySent && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <h4 className="font-semibold text-yellow-800 dark:text-yellow-200">
                Feedback Already Sent
              </h4>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                WhatsApp feedback was sent for this DR on{' '}
                <strong>
                  {feedbackSentAt
                    ? `${new Date(feedbackSentAt).toISOString().split('T')[0]} ${new Date(feedbackSentAt).toTimeString().slice(0, 5)}`
                    : 'unknown date'}
                </strong>
              </p>
              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmResend}
                  onChange={(e) => setConfirmResend(e.target.checked)}
                  className="h-4 w-4 text-yellow-600 border-yellow-400 rounded focus:ring-yellow-500"
                />
                <span className="text-sm text-yellow-800 dark:text-yellow-200">
                  Yes, send feedback again (technician will receive a new message)
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

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

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          This message will be sent to the project WhatsApp group.
        </p>
      </div>

      {/* Destination & Staff Options */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h4 className="font-semibold text-gray-900 dark:text-white mb-4">
          Message Destination
        </h4>

        <div className="space-y-4">
          {/* Destination Radio Buttons */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Send feedback to:
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="destination"
                  value="group"
                  checked={feedbackDestination === 'group'}
                  onChange={() => setFeedbackDestination('group')}
                  className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Group only ({project || 'Project Group'})
                </span>
              </label>
              <label className={`flex items-center gap-3 ${hasTechnicianJid ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                <input
                  type="radio"
                  name="destination"
                  value="private"
                  checked={feedbackDestination === 'private'}
                  onChange={() => setFeedbackDestination('private')}
                  disabled={!hasTechnicianJid}
                  className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Private message to technician only
                </span>
              </label>
              <label className={`flex items-center gap-3 ${hasTechnicianJid ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                <input
                  type="radio"
                  name="destination"
                  value="both"
                  checked={feedbackDestination === 'both'}
                  onChange={() => setFeedbackDestination('both')}
                  disabled={!hasTechnicianJid}
                  className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Both group and private
                </span>
              </label>
            </div>
            {!hasTechnicianJid && (
              <p className="text-xs text-yellow-600 mt-2">
                Private messaging unavailable - technician JID not found for this DR.
              </p>
            )}
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* Staff Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Tag Staff Member (Optional)
            </label>
            <select
              value={selectedStaffId || ''}
              onChange={(e) => setSelectedStaffId(e.target.value || null)}
              disabled={loadingStaff}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-900 text-sm"
            >
              <option value="">
                {loadingStaff ? 'Loading staff...' : '-- Select staff to tag --'}
              </option>
              {availableStaff
                .filter((s) => s.whatsappId) // Only show staff with WhatsApp ID
                .map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name} {staff.position ? `(${staff.position})` : ''}
                  </option>
                ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Selected staff will be @mentioned in the WhatsApp message.
              {availableStaff.filter(s => s.whatsappId).length === 0 && !loadingStaff && (
                <span className="text-yellow-600"> No staff have WhatsApp IDs configured.</span>
              )}
            </p>
          </div>

          {/* Send Private Copy to Staff */}
          {selectedStaffId && (
            <div className="flex items-start gap-3 pl-1">
              <input
                type="checkbox"
                id="sendStaffPrivate"
                checked={sendStaffPrivate}
                onChange={(e) => setSendStaffPrivate(e.target.checked)}
                className="mt-1 h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
              />
              <div>
                <label htmlFor="sendStaffPrivate" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Also send private copy to selected staff
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Staff will receive a private message in addition to being tagged.
                </p>
              </div>
            </div>
          )}

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* Task Creation Checkbox */}
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="createTask"
              checked={createTask}
              onChange={(e) => setCreateTask(e.target.checked)}
              className="mt-1 h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
            />
            <div>
              <label htmlFor="createTask" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Create follow-up task
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {feedback.decision === 'PASS'
                  ? 'Optionally create a task for this review.'
                  : 'A task will be created for rework tracking.'}
              </p>
            </div>
          </div>
        </div>
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
            disabled={isSending || !feedback.customMessage.trim() || (feedbackAlreadySent && !confirmResend)}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSending ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Sending...
              </>
            ) : feedbackAlreadySent ? (
              <>
                <span>🔄</span>
                Resend Feedback
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
