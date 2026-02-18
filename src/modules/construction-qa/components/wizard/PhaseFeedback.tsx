/**
 * Phase 5: Feedback
 * Shows QA result summary and WhatsApp feedback status.
 */

import { CheckCircle, XCircle, AlertTriangle, MessageSquare, Clock } from 'lucide-react';
import type { QaDecision, WorkflowStatus } from '../../types';

interface Props {
  review: {
    workflow_status: WorkflowStatus;
    qa_decision: QaDecision | null;
    qa_decision_at: string | null;
    qa_decision_by: string | null;
    qa_notes: string | null;
    qa_reason_code: string | null;
    wa_feedback_sent_at: string | null;
    wa_feedback_message: string | null;
    feature_id: string;
    discipline: string;
    project_name: string;
    [key: string]: unknown;
  };
}

export function PhaseFeedback({ review }: Props) {
  const decisionIcon = review.qa_decision === 'PASS'
    ? CheckCircle
    : review.qa_decision === 'FAIL'
      ? XCircle
      : review.qa_decision === 'REWORK_NEEDED'
        ? AlertTriangle
        : Clock;

  const DecisionIcon = decisionIcon;

  const decisionColor = review.qa_decision === 'PASS'
    ? 'text-green-400'
    : review.qa_decision === 'FAIL'
      ? 'text-red-400'
      : review.qa_decision === 'REWORK_NEEDED'
        ? 'text-orange-400'
        : 'text-gray-400';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Review Complete</h2>
        <p className="text-sm text-gray-400">
          Summary of the QA decision and feedback status.
        </p>
      </div>

      {/* Decision Summary */}
      <div className={`p-6 rounded-lg border-2 text-center ${
        review.qa_decision === 'PASS' ? 'border-green-500/50 bg-green-500/10' :
        review.qa_decision === 'FAIL' ? 'border-red-500/50 bg-red-500/10' :
        review.qa_decision === 'REWORK_NEEDED' ? 'border-orange-500/50 bg-orange-500/10' :
        'border-gray-500/50 bg-gray-500/10'
      }`}>
        <DecisionIcon className={`w-16 h-16 mx-auto mb-3 ${decisionColor}`} />
        <h3 className={`text-2xl font-bold ${decisionColor}`}>
          {review.qa_decision || 'PENDING'}
        </h3>
        <p className="text-sm text-gray-400 mt-2">
          {review.feature_id} · {review.discipline} · {review.project_name}
        </p>
        {review.qa_decision_at && (
          <p className="text-xs text-gray-500 mt-1">
            Decided {new Date(review.qa_decision_at).toLocaleString()}
            {review.qa_decision_by && ` by ${review.qa_decision_by}`}
          </p>
        )}
      </div>

      {/* Notes */}
      {review.qa_notes && (
        <div className="p-4 bg-gray-900 rounded-lg">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Decision Notes</h3>
          <p className="text-sm text-gray-400 whitespace-pre-wrap">{review.qa_notes}</p>
        </div>
      )}

      {/* Reason Code */}
      {review.qa_reason_code && (
        <div className="p-4 bg-gray-900 rounded-lg">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Reason Code</h3>
          <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">
            {review.qa_reason_code.replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {/* WhatsApp Feedback Status */}
      <div className={`p-4 rounded-lg border ${
        review.wa_feedback_sent_at
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-gray-500/30 bg-gray-500/5'
      }`}>
        <div className="flex items-center gap-3">
          <MessageSquare className={`w-5 h-5 ${review.wa_feedback_sent_at ? 'text-green-400' : 'text-gray-500'}`} />
          <div>
            <h3 className="text-sm font-medium text-gray-300">
              WhatsApp Feedback
            </h3>
            {review.wa_feedback_sent_at ? (
              <p className="text-xs text-green-400 mt-0.5">
                Sent {new Date(review.wa_feedback_sent_at).toLocaleString()}
              </p>
            ) : review.qa_decision === 'PASS' ? (
              <p className="text-xs text-gray-500 mt-0.5">
                No feedback needed — feature passed QA.
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-0.5">
                Feedback not yet sent to technician.
              </p>
            )}
          </div>
        </div>

        {review.wa_feedback_message && (
          <div className="mt-3 p-3 bg-gray-900 rounded text-xs text-gray-400 whitespace-pre-wrap font-mono">
            {review.wa_feedback_message}
          </div>
        )}
      </div>

      {/* Actions */}
      {!review.qa_decision && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-sm text-yellow-400">
            No decision has been made yet. Go back to the Decision phase to submit your review.
          </p>
        </div>
      )}
    </div>
  );
}
