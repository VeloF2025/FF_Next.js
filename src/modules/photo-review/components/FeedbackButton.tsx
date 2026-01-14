/**
 * Feedback Button Component
 * Handles sending WhatsApp feedback with preview dialog
 *
 * Updated to use FibreFlow premium components (VelocityButton, GlassCard)
 */

'use client';

import { useState } from 'react';
import { Send, X } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';
import type { FeedbackButtonProps} from '../types';

export function FeedbackButton({
  dr_number,
  evaluation,
  onSendFeedback,
  isSending,
  disabled,
}: FeedbackButtonProps) {
  const [showPreview, setShowPreview] = useState(false);

  if (!evaluation) {
    return null;
  }

  const formatFeedbackMessage = () => {
    const statusEmoji = evaluation.overall_status === 'PASS' ? '✅' : '❌';
    const failedSteps = evaluation.step_results.filter((s) => !s.passed);

    let message = `${statusEmoji} Installation Photo Review: ${dr_number}\n\n`;
    message += `Overall Status: ${evaluation.overall_status}\n`;
    message += `Score: ${evaluation.average_score.toFixed(1)}/10\n`;
    message += `Steps Passed: ${evaluation.passed_steps}/${evaluation.total_steps}\n\n`;

    if (failedSteps.length > 0) {
      message += `❌ Failed Steps:\n`;
      failedSteps.forEach((step) => {
        message += `• ${step.step_label}: ${step.comment}\n`;
      });
      message += `\nPlease retake photos following installation guidelines.`;
    } else {
      message += `✅ All steps passed! Great work!`;
    }

    return message;
  };

  const handleSend = async () => {
    setShowPreview(false);
    await onSendFeedback(dr_number);
  };

  if (evaluation.feedback_sent) {
    return (
      <div className="text-center py-2 text-sm">
        <span className="text-green-400 font-medium">✓ Feedback sent</span>
        {evaluation.feedback_sent_at && (
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            {new Date(evaluation.feedback_sent_at).toLocaleString()}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <VelocityButton
        onClick={() => setShowPreview(true)}
        disabled={disabled || isSending}
        variant="glass-primary"
        size="lg"
        className="w-full"
        loading={isSending}
      >
        <Send className="w-4 h-4 mr-2" />
        {isSending ? 'Sending...' : 'Send Feedback'}
      </VelocityButton>

      {/* Preview Dialog */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <GlassCard variant="strong" elevation={6} rounded="lg" padding="none" className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/20">
              <h3 className="text-lg font-semibold text-white">Preview WhatsApp Message</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-[var(--ff-text-tertiary)] hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Message Preview */}
            <div className="p-6">
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <pre className="whitespace-pre-wrap text-sm text-[var(--ff-text-primary)] font-sans">
                  {formatFeedbackMessage()}
                </pre>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-white/20">
              <VelocityButton
                onClick={() => setShowPreview(false)}
                variant="glass"
                size="md"
              >
                Cancel
              </VelocityButton>
              <VelocityButton
                onClick={handleSend}
                disabled={isSending}
                variant="glass-primary"
                size="md"
                loading={isSending}
              >
                <Send className="w-4 h-4 mr-2" />
                Confirm Send
              </VelocityButton>
            </div>
          </GlassCard>
        </div>
      )}
    </>
  );
}
