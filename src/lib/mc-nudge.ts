import { log } from '@/lib/logger';

interface NudgeOptions {
  toAgent: string;
  subject?: string;
  /** Display name of the person sending the nudge. Defaults to "Operator". */
  senderName?: string;
}

/**
 * Send a nudge notification to an agent via MC API.
 * Nudge creates a directive message in MC and wakes the agent.
 *
 * @param options - Nudge configuration
 * @returns true if nudge was sent successfully, false otherwise
 */
export async function nudgeAgent(options: NudgeOptions): Promise<boolean> {
  const { toAgent, subject = 'Unread message pending', senderName = 'Operator' } = options;

  if (!toAgent) {
    log.warn('mc-nudge', { error: 'toAgent is required' });
    return false;
  }

  try {
    // POST a nudge message to MC API
    // The message format: "Nudge from [sender]: action your pending message: [subject]"
    const now = new Date().toLocaleTimeString('en-ZA', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const response = await fetch('/api/mission-control/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_agent: toAgent,
        type: 'directive',
        message: `Nudge from ${senderName} at ${now}: action your pending message — ${subject}`,
        payload: {
          nudge: true,
          nudge_time: new Date().toISOString(),
          original_subject: subject,
        },
      }),
    });

    if (!response.ok) {
      log.warn('mc-nudge', { error: `HTTP ${response.status}`, toAgent });
      return false;
    }

    log.info('mc-nudge-sent', { toAgent, subject });
    return true;
  } catch (error) {
    log.error('mc-nudge-error', { error: error instanceof Error ? error.message : String(error), toAgent });
    return false;
  }
}
