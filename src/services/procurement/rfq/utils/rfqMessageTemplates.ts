/**
 * RFQ Message Templates
 * Message templates for notifications
 */

/**
 * Get notification message template
 */
interface RfqMessageData {
  rfqNumber?: string;
  rfq_number?: string;
  responseDeadline?: string | Date;
  response_deadline?: string | Date;
}

export function getNotificationMessage(type: string, rfq: RfqMessageData): string {
  const templates: Record<string, string> = {
    invitation: `You have been invited to submit a quote for RFQ ${rfq.rfqNumber || rfq.rfq_number}. The deadline is ${new Date(rfq.responseDeadline || rfq.response_deadline).toISOString().split('T')[0]}.`,
    reminder: `This is a reminder that the deadline for RFQ ${rfq.rfqNumber || rfq.rfq_number} is approaching.`,
    deadline_extended: `The deadline for RFQ ${rfq.rfqNumber || rfq.rfq_number} has been extended.`,
    evaluation: `Your response for RFQ ${rfq.rfqNumber || rfq.rfq_number} is being evaluated.`,
    award: `RFQ ${rfq.rfqNumber || rfq.rfq_number} has been awarded.`,
    cancellation: `RFQ ${rfq.rfqNumber || rfq.rfq_number} has been cancelled.`
  };

  return templates[type] || `Update regarding RFQ ${rfq.rfqNumber || rfq.rfq_number}`;
}

/**
 * Get email subject template
 */
export function getEmailSubject(type: string, rfqNumber: string): string {
  const subjects: Record<string, string> = {
    invitation: `Invitation to Quote: RFQ ${rfqNumber}`,
    reminder: `Reminder: RFQ ${rfqNumber} Deadline Approaching`,
    deadline_extended: `Deadline Extended: RFQ ${rfqNumber}`,
    evaluation: `Response Under Evaluation: RFQ ${rfqNumber}`,
    award: `RFQ Awarded: ${rfqNumber}`,
    cancellation: `RFQ Cancelled: ${rfqNumber}`,
    response_received: `New Response Received: RFQ ${rfqNumber}`
  };

  return subjects[type] || `Update: RFQ ${rfqNumber}`;
}
