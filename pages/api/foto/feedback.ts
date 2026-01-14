/**
 * POST /api/foto/feedback
 * Send WhatsApp feedback for an evaluation
 * Integrates with wa-monitor service and updates database
 *
 * Project Routing Logic:
 * - DRs with "test" in the number (e.g., DRTEST0808) → Velo Test WhatsApp group
 * - Projects with "test" in name → Velo Test WhatsApp group
 * - Lawley → Lawley Activation 3 group
 * - Mohadin → Mohadin Activations group
 * - Mamelodi → Mamelodi POP1 Activations group
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getEvaluationByDR, markFeedbackSent, getDropSubmitterPhone } from '@/modules/photo-review/services/fotoDbService';
import { validateDrNumber } from '@/modules/photo-review/utils/drValidator';

// Project WhatsApp group mappings (same as wa-monitor)
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

/**
 * Send message to WhatsApp group
 * Uses Sender API (8081) with @mention if phone number available
 * Falls back to Bridge API (8080) without @mention if no phone number
 */
async function sendWhatsAppFeedback(drNumber: string, message: string, project?: string): Promise<void> {
  // Get project group JID - default to Velo Test if project is unknown/undefined
  let projectKey = project || 'Velo Test';

  // If project is "Unknown" or not in mapping, use Velo Test as fallback
  if (projectKey === 'Unknown' || !PROJECT_GROUPS[projectKey]) {
    console.log(`[WhatsApp] Project "${projectKey}" not mapped, using Velo Test as default`);
    projectKey = 'Velo Test';
  }

  const groupConfig = PROJECT_GROUPS[projectKey];

  if (!groupConfig) {
    throw new Error(`No WhatsApp group configured for project: ${projectKey}`);
  }

  // Try to get submitter's phone number from qa_photo_reviews (WA Monitor data)
  const submitterPhone = await getDropSubmitterPhone(drNumber);

  if (submitterPhone) {
    // Use Sender API with @mention (port 8081)
    console.log(`[WhatsApp] Using Sender API with @mention for ${submitterPhone}`);

    const response = await fetch('http://localhost:8081/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_jid: groupConfig.jid,
        recipient_jid: submitterPhone + '@s.whatsapp.net',  // Format for WhatsApp JID
        message: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WhatsApp] Sender API failed, falling back to Bridge API: ${errorText}`);
      // Fall through to Bridge API below
    } else {
      const result = await response.json();
      if (result.success) {
        return; // Success with @mention
      }
      console.error(`[WhatsApp] Sender API failed: ${result.message || 'Unknown error'}`);
    }
  }

  // Fallback: Use Bridge API without @mention (port 8080)
  console.log(`[WhatsApp] Using Bridge API without @mention (no phone number found or Sender API failed)`);

  const response = await fetch('http://localhost:8080/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: groupConfig.jid,  // Bridge API uses 'recipient' instead of 'group_jid'
      message: message,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(`Failed to send WhatsApp message: ${result.message || 'Unknown error'}`);
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dr_number, message: customMessage, project } = req.body;

    // Validate DR number format and check for SQL injection
    const validation = validateDrNumber(dr_number);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid DR number',
        message: validation.error,
      });
    }

    // Use sanitized DR number
    const sanitizedDr = validation.sanitized!;

    // If custom message is provided, use it directly
    // Otherwise, fetch evaluation and generate message
    let message: string;
    let evaluationProject: string | undefined;

    if (customMessage) {
      // Use the custom message provided by the human agent
      message = customMessage;
      // If project or DR number contains "test", route to Velo Test group
      const isTestDR = sanitizedDr.toLowerCase().includes('test');
      const isTestProject = project?.toLowerCase().includes('test');
      evaluationProject = (isTestDR || isTestProject) ? 'Velo Test' : project;
    } else {
      // Fetch evaluation from database
      const evaluation = await getEvaluationByDR(sanitizedDr);

      if (!evaluation) {
        return res.status(404).json({
          error: 'Evaluation not found',
          message: `No evaluation found for DR ${sanitizedDr}. Please run evaluation first.`,
        });
      }

      // Check if feedback was already sent (only when using auto-generated)
      if (evaluation.feedback_sent) {
        return res.status(400).json({
          error: 'Feedback already sent',
          message: `Feedback for DR ${sanitizedDr} was already sent on ${evaluation.feedback_sent_at?.toISOString()}`,
        });
      }

      // Format WhatsApp message
      message = formatFeedbackMessage(evaluation);
      // If project or DR number contains "test", route to Velo Test group
      const isTestDR = sanitizedDr.toLowerCase().includes('test');
      const isTestProject = evaluation.project?.toLowerCase().includes('test');
      evaluationProject = (isTestDR || isTestProject) ? 'Velo Test' : evaluation.project;
    }

    // Send via WhatsApp (using wa-monitor service on VPS)
    // Feature flag: USE_WHATSAPP_FEEDBACK to enable/disable actual WhatsApp sending
    const USE_WHATSAPP = process.env.USE_WHATSAPP_FEEDBACK === 'true';

    if (USE_WHATSAPP) {
      try {
        console.log(`[WhatsApp] Sending feedback for ${sanitizedDr} to project: ${evaluationProject || 'Velo Test (default)'}...`);
        await sendWhatsAppFeedback(sanitizedDr, message, evaluationProject);
        console.log(`[WhatsApp] Feedback sent successfully to ${evaluationProject || 'Velo Test'} group`);
      } catch (error) {
        console.error(`[WhatsApp] Failed to send feedback:`, error);
        // Don't fail the request if WhatsApp fails - still update database
        // This allows the system to work even if WhatsApp service is down
      }
    } else {
      console.log(`[MOCK] WhatsApp feedback for ${sanitizedDr}:`);
      console.log(message);
    }

    // Update feedback_sent flag in database (only if we have an evaluation)
    let feedbackStatus = { feedback_sent: true, feedback_sent_at: new Date() };

    if (!customMessage) {
      // Only update database if we're using an evaluation from DB
      const updatedEvaluation = await markFeedbackSent(sanitizedDr);
      feedbackStatus = {
        feedback_sent: updatedEvaluation.feedback_sent,
        feedback_sent_at: updatedEvaluation.feedback_sent_at
      };
    }

    return res.status(200).json({
      success: true,
      data: {
        dr_number: sanitizedDr,
        feedback_sent: feedbackStatus.feedback_sent,
        feedback_sent_at: feedbackStatus.feedback_sent_at,
        message: USE_WHATSAPP
          ? 'Feedback sent to WhatsApp successfully'
          : 'Feedback logged successfully (WhatsApp disabled)',
      },
    });
  } catch (error) {
    console.error('Error sending feedback:', error);
    return res.status(500).json({
      error: 'Failed to send feedback',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Format evaluation results as WhatsApp message
 */
function formatFeedbackMessage(evaluation: any): string {
  const statusEmoji = evaluation.overall_status === 'PASS' ? '✅' : '❌';
  const passPercentage = Math.round((evaluation.passed_steps / evaluation.total_steps) * 100);

  let message = `${statusEmoji} Installation Photo Review: ${evaluation.dr_number}\n\n`;
  message += `Overall Status: ${evaluation.overall_status}\n`;
  message += `Score: ${evaluation.average_score}/10\n`;
  message += `Steps Passed: ${evaluation.passed_steps}/${evaluation.total_steps} (${passPercentage}%)\n\n`;
  message += `📋 Step Results:\n`;

  evaluation.step_results.forEach((step: any) => {
    const icon = step.passed ? '✅' : '❌';
    message += `${icon} ${step.step_label}: ${step.score.toFixed(1)}/10\n`;
    message += `   ${step.comment}\n\n`;
  });

  if (evaluation.overall_status === 'FAIL') {
    message += `⚠️ Please review and retake photos for failed steps following installation guidelines.`;
  } else {
    message += `✅ Great work! All photos meet quality standards.`;
  }

  return message;
}
