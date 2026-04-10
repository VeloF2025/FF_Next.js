/**
 * WA Monitor Send Feedback API
 * Sends QA feedback to WhatsApp groups via WhatsApp Bridge
 * Updates feedback_sent timestamp in database
 *
 * Protected by Arcjet:
 * - Bot detection
 * - Rate limiting (60 req/min)
 * - Attack protection
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { QA_STEP_LABELS, ORDERED_STEP_KEYS } from '@/modules/wa-monitor/types/wa-monitor.types';
import { withArcjetProtection, ajWaMonitor } from '@/lib/arcjet';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');

// WhatsApp Feedback service configuration (Jan 2026)
// wa-feedback (port 8092) proxies to bridge-2 (port 8083) for all outgoing messages
// Phone number: 063 841 2276 (bridge-2)
// All environments (dev/staging/prod) use the same Velocity server via Tailscale
const WA_FEEDBACK_URL = process.env.WA_FEEDBACK_URL || 'http://100.96.203.105:8092';

// Project WhatsApp group mappings
const PROJECT_GROUPS: Record<string, { jid: string; name: string }> = {
  'Velo Test': {
    jid: '120363421664266245@g.us',
    name: 'Velo Test'
  },
  'Lawley': {
    jid: '120363418298130331@g.us',
    name: 'Lawley Activation 3'
  },
  'Mohadin': {
    jid: '120363421532174586@g.us',
    name: 'Mohadin Activations 🥳'
  },
  'Mamelodi': {
    jid: '120363408849234743@g.us',
    name: 'Mamelodi POP1 Activations'
  }
};

interface SendFeedbackRequest {
  dropId: string;
  dropNumber: string;
  message: string;
  project?: string;
}

interface QAReview {
  drop_number: string;
  submitted_by: string | null;
  project: string;
  step_01_house_photo: boolean;
  step_02_cable_from_pole: boolean;
  step_03_cable_entry_outside: boolean;
  step_04_cable_entry_inside: boolean;
  step_05_wall_for_installation: boolean;
  step_06_ont_back_after_install: boolean;
  step_07_power_meter_reading: boolean;
  step_08_ont_barcode: boolean;
  step_09_ups_serial: boolean;
  step_10_final_installation: boolean;
  step_11_green_lights: boolean;
  step_12_customer_signature: boolean;
}

interface WhatsAppApiResponse {
  success: boolean;
  message?: string;
}

/**
 * Send message to WhatsApp group via wa-feedback service
 * wa-feedback (8092) proxies to bridge-2 (8083) using 063 841 2276
 * Now supports @mentions - bridge adds @user text AND MentionedJID context
 * so WhatsApp displays the user's name instead of raw number
 */
async function sendWhatsAppMessage(
  groupJID: string,
  recipientJID: string | null,
  message: string
): Promise<{ success: boolean; message: string }> {
  try {
    // wa-feedback service handles all outgoing messages
    // It proxies to bridge-2 (8083) which sends via 063 841 2276
    const requestBody: Record<string, string | string[]> = {
      recipient: groupJID,
      message: message,
    };

    // Add mention support - send recipient_jid for @mention
    // The bridge will add @user text AND MentionedJID context (shows name in WhatsApp)
    if (recipientJID && recipientJID.trim() !== '' && recipientJID !== 'Unknown') {
      requestBody.recipient_jid = recipientJID;
      log.debug('waMonitor', { action: 'sendWhatsAppMessage', groupJID, recipientJID, hasMention: true });
    } else {
      log.debug('waMonitor', { action: 'sendWhatsAppMessage', groupJID, hasMention: false });
    }

    const response = await fetch(`${WA_FEEDBACK_URL}/send-feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60000), // 60 second timeout for slow connections
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: `wa-feedback API error: HTTP ${response.status} - ${errorText}`
      };
    }

    const result: WhatsAppApiResponse = await response.json();
    return {
      success: result.success || false,
      message: result.message || 'Message sent via wa-feedback (063 841 2276)'
    };
  } catch (error) {
    log.error('waMonitor', { action: 'sendWhatsAppMessage', error });
    return {
      success: false,
      message: `Failed to communicate with wa-feedback: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Format QA checklist for WhatsApp message
 * Uses ORDERED_STEP_KEYS to ensure message order matches dashboard display
 */
function formatQAChecklist(review: QAReview, customMessage: string): string {
  const checkmark = '[OK]';
  const cross = '[MISSING]';

  // Build steps array using ORDERED_STEP_KEYS (matches dashboard order 1-12)
  const steps = ORDERED_STEP_KEYS.map(key => ({
    label: QA_STEP_LABELS[key],
    value: review[key]
  }));

  const allPassed = steps.every(step => step.value);
  const statusText = allPassed ? 'APPROVED' : 'REJECTED';

  // Add blank lines at start to separate @mention from content
  // Format: @mention (added by sender), then blank lines, then drop number and status
  let message = `\n\n${review.drop_number}\n${statusText}\n\n`;

  // Add checklist
  for (const step of steps) {
    const symbol = step.value ? checkmark : cross;
    message += `${symbol} ${step.label}\n`;
  }

  // Add custom message if provided
  if (customMessage && customMessage.trim()) {
    message += `\n${customMessage.trim()}`;
  }

  return message;
}

/**
 * Next.js API config - extend timeout for slow connections
 */
export const config = {
  api: {
    responseLimit: false,
    externalResolver: true,
  },
  maxDuration: 60, // 60 seconds max execution time
};

/**
 * Update feedback_sent timestamp in database
 */
async function updateFeedbackSentTimestamp(dropId: string): Promise<void> {
  await sql`
    UPDATE qa_photo_reviews
    SET
      feedback_sent = NOW(),
      updated_at = NOW()
    WHERE id = ${dropId}
  `;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { message: 'Method not allowed' }
    });
  }

  try {
    const { dropId, message }: SendFeedbackRequest = req.body;

    // Validation
    if (!dropId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required field: dropId' }
      });
    }

    // 1. Get drop details from database
    const drops = await sql<QAReview[]>`
      SELECT
        drop_number,
        submitted_by,
        project,
        step_01_house_photo,
        step_02_cable_from_pole,
        step_03_cable_entry_outside,
        step_04_cable_entry_inside,
        step_05_wall_for_installation,
        step_06_ont_back_after_install,
        step_07_power_meter_reading,
        step_08_ont_barcode,
        step_09_ups_serial,
        step_10_final_installation,
        step_11_green_lights,
        step_12_customer_signature
      FROM qa_photo_reviews
      WHERE id = ${dropId}
      LIMIT 1
    `;

    if (drops.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Drop not found' }
      });
    }

    const drop = drops[0]!;

    // 2. Get group JID for project
    const groupConfig = PROJECT_GROUPS[drop.project];
    if (!groupConfig) {
      return res.status(400).json({
        success: false,
        error: { message: `Unknown project: ${drop.project}. Cannot determine WhatsApp group.` }
      });
    }

    log.debug('waMonitor', {
      action: 'sendFeedback',
      dropNumber: drop.drop_number,
      group: groupConfig.name,
      groupJID: groupConfig.jid,
      hasMention: !!(drop.submitted_by && drop.submitted_by.trim() !== '' && drop.submitted_by !== 'Unknown'),
      submittedBy: drop.submitted_by || 'manual'
    });

    // 3. Use the custom message directly (user already generated feedback with Auto-Generate)
    // Note: We don't add @phone to message - bridge does that with proper MentionedJID context
    const feedbackMessage = `${message || ''}`;

    // 4. Convert submitted_by to proper JID format if needed
    // qa_photo_reviews stores raw LID like "169200706420977", need "169200706420977@lid"
    let recipientJid: string | null = null;
    if (drop.submitted_by && drop.submitted_by.trim() !== '' && drop.submitted_by !== 'Unknown') {
      recipientJid = drop.submitted_by.includes('@') ? drop.submitted_by : `${drop.submitted_by}@lid`;
    }

    // 5. Send to WhatsApp (with mention if we have recipient JID)
    const whatsappResult = await sendWhatsAppMessage(
      groupConfig.jid,
      recipientJid,
      feedbackMessage
    );

    if (!whatsappResult.success) {
      return res.status(500).json({
        success: false,
        error: {
          message: `Failed to send WhatsApp message: ${whatsappResult.message}`,
          details: whatsappResult.message
        }
      });
    }

    // 6. Update database with feedback_sent timestamp
    await updateFeedbackSentTimestamp(dropId);

    log.debug('waMonitor', {
      action: 'feedbackSentSuccess',
      dropNumber: drop.drop_number,
      project: drop.project,
      group: groupConfig.name
    });

    return res.status(200).json({
      success: true,
      data: {
        dropNumber: drop.drop_number,
        project: drop.project,
        group: groupConfig.name,
        recipient: drop.submitted_by,
        sentAt: new Date().toISOString()
      },
      message: `Feedback sent to ${groupConfig.name}`
    });

  } catch (error) {
    log.error('waMonitor', { action: 'sendFeedback', error });
    return res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
}

// Export with Arcjet protection and auth
export default withAuth(withArcjetProtection(handler, ajWaMonitor));
