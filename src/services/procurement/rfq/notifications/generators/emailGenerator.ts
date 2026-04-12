/**
 * RFQ Email Content Generator
 * Generates HTML and text email content for RFQ notifications
 *
 * Refactored for maintainability - templates organized in separate modules
 */

import { RFQ } from '@/types/procurement.types';
import { EmailContent, EmailEvent } from './types';
import { BaseRFQGenerator } from './baseGenerator';
import { generateSubject } from './email/utils/subjects';
import { HTMLTemplates } from './email/templates/htmlTemplates';
import { TextTemplates } from './email/text-templates/textTemplates';

export class RFQEmailGenerator extends BaseRFQGenerator {
  /**
   * Generate email content for RFQ events
   */
  static generateEmailContent(
    event: EmailEvent,
    rfq: RFQ,
    additionalData?: Record<string, unknown>
  ): EmailContent {
    const rfqUrl = `${this.getBaseUrl()}${this.generateRFQLink(rfq.id)}`;
    const responseUrl = `${this.getBaseUrl()}${this.generateSupplierRFQLink(rfq.id, '/respond')}`;

    switch (event) {
      case 'rfq_issued':
        return {
          subject: generateSubject(event, rfq),
          content: HTMLTemplates.rfqIssued(rfq, rfqUrl, responseUrl),
          textContent: TextTemplates.rfqIssued(rfq, rfqUrl)
        };

      case 'deadline_extended': {
        const newDeadline = (additionalData?.newDeadline as Date | undefined) ?? rfq.responseDeadline;
        return {
          subject: generateSubject(event, rfq),
          content: HTMLTemplates.deadlineExtended(rfq, newDeadline, rfqUrl),
          textContent: TextTemplates.deadlineExtended(rfq, newDeadline, rfqUrl)
        };
      }

      case 'cancelled': {
        const reason = (additionalData?.reason as string | undefined) ?? 'No reason provided';
        return {
          subject: generateSubject(event, rfq),
          content: HTMLTemplates.cancelled(rfq, reason),
          textContent: TextTemplates.cancelled(rfq, reason)
        };
      }

      case 'awarded': {
        const isWinner = (additionalData?.isWinner as boolean | undefined) ?? false;
        const winnerName = (additionalData?.winnerName as string | undefined) ?? 'the selected supplier';
        return {
          subject: generateSubject(event, rfq),
          content: isWinner
            ? HTMLTemplates.awardedWinner(rfq, rfqUrl)
            : HTMLTemplates.awardedOther(rfq, winnerName),
          textContent: isWinner
            ? TextTemplates.awardedWinner(rfq)
            : TextTemplates.awardedOther(rfq, winnerName)
        };
      }

      case 'reminder_deadline': {
        const hoursRemaining = this.getHoursRemaining(rfq);
        return {
          subject: generateSubject(event, rfq, hoursRemaining),
          content: HTMLTemplates.reminder(rfq, hoursRemaining, responseUrl),
          textContent: TextTemplates.reminder(rfq, hoursRemaining, responseUrl)
        };
      }

      case 'response_confirmation': {
        const responseId = (additionalData?.responseId as string | undefined) ?? 'N/A';
        return {
          subject: generateSubject(event, rfq),
          content: HTMLTemplates.responseConfirmation(rfq, responseId),
          textContent: TextTemplates.responseConfirmation(rfq, responseId)
        };
      }

      default:
        return {
          subject: generateSubject(event, rfq),
          content: `<p>There has been an update to RFQ: ${rfq.title}</p>`,
          textContent: `There has been an update to RFQ: ${rfq.title}`
        };
    }
  }
}
