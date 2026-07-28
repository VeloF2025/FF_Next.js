/**
 * Cloud test send card.
 *
 * Sends one message on the Cloud channel to an operator-typed number using
 * whatever credentials are configured, and shows the provider's real answer.
 * It never changes the active provider.
 */

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, SendHorizonal, XCircle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaTestSendResult } from '../types/wa-admin.types';

type Outcome =
  | { kind: 'sent'; providerMessageId?: string }
  | { kind: 'not-configured'; error: string }
  | { kind: 'failed'; error: string };

function toOutcome(result: WaTestSendResult): Outcome {
  if (result.ok) return { kind: 'sent', providerMessageId: result.providerMessageId };
  const error = result.error || 'The send was rejected without an error message.';
  return result.notConfigured ? { kind: 'not-configured', error } : { kind: 'failed', error };
}

const WaTestSendCard: React.FC = () => {
  const [toPhone, setToPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const handleSend = async () => {
    if (!toPhone.trim() || sending) return;

    setSending(true);
    setOutcome(null);

    const response = await waAdminApi.goLive.testSend({
      toPhone,
      ...(message.trim() ? { message } : {}),
    });

    setOutcome(
      response.success && response.data
        ? toOutcome(response.data)
        : { kind: 'failed', error: response.error || 'Test send request failed' }
    );
    setSending(false);
  };

  return (
    <section className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      <div className="bg-[var(--ff-bg-secondary)] px-4 py-3 border-b border-[var(--ff-border-light)]">
        <h4 className="font-medium text-[var(--ff-text-primary)]">Cloud test send</h4>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Sends one message on the Cloud channel only. It does not change the active provider.
        </p>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label htmlFor="wa-test-phone" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
            Recipient number
          </label>
          <input
            id="wa-test-phone"
            type="tel"
            value={toPhone}
            onChange={(e) => setToPhone(e.target.value)}
            placeholder="0821234567"
            className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <div>
          <label htmlFor="wa-test-message" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
            Message <span className="text-[var(--ff-text-tertiary)] font-normal">(optional)</span>
          </label>
          <textarea
            id="wa-test-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Leave blank to send the default test message"
            className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <button
          onClick={handleSend}
          disabled={sending || !toPhone.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          {sending ? <InlineSpinner size="sm" /> : <SendHorizonal className="w-4 h-4" aria-hidden="true" />}
          Send test message
        </button>

        {outcome && <TestSendOutcome outcome={outcome} />}
      </div>
    </section>
  );
};

const TestSendOutcome: React.FC<{ outcome: Outcome }> = ({ outcome }) => {
  const style =
    outcome.kind === 'sent'
      ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
      : outcome.kind === 'not-configured'
        ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400'
        : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400';

  const Icon = outcome.kind === 'sent' ? CheckCircle2 : outcome.kind === 'not-configured' ? AlertTriangle : XCircle;

  return (
    <div
      data-testid="wa-test-send-result"
      role="status"
      className={`flex items-start gap-2 p-3 border rounded text-sm ${style}`}
    >
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {outcome.kind === 'sent' ? (
          <>
            <p className="font-medium">Message accepted by WhatsApp Cloud.</p>
            {outcome.providerMessageId && (
              <p className="mt-0.5 break-all">Provider message id: {outcome.providerMessageId}</p>
            )}
          </>
        ) : (
          <>
            <p className="font-medium">
              {outcome.kind === 'not-configured' ? 'Cloud credentials incomplete' : 'Send failed'}
            </p>
            <p className="mt-0.5 break-words">{outcome.error}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default WaTestSendCard;
