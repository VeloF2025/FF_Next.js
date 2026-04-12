/**
 * RFQ Email HTML Templates
 * Contains HTML email template generators
 */

import { RFQ } from '@/types/procurement.types';
import { formatDisplayDateTime } from '@/utils/dateFormat';

export class RFQEmailHTMLTemplates {
  /**
   * Generate HTML for RFQ issued email
   */
  static generateRFQIssuedHTML(rfq: RFQ, rfqUrl: string, responseUrl: string, _additionalData?: Record<string, unknown>): string {
    const deadline = rfq.responseDeadline;
    const deadlineText = deadline ? this.formatDeadline(deadline) : 'Not specified';
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">New RFQ: ${rfq.title}</h2>
        
        <p>You have been invited to respond to a new Request for Quotation.</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>RFQ Details:</h3>
          <ul style="list-style: none; padding: 0;">
            <li><strong>Title:</strong> ${rfq.title}</li>
            <li><strong>Project ID:</strong> ${rfq.projectId}</li>
            <li><strong>Response Deadline:</strong> ${deadlineText}</li>
            ${rfq.description ? `<li><strong>Description:</strong> ${rfq.description}</li>` : ''}
          </ul>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${responseUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Submit Response
          </a>
          <br><br>
          <a href="${rfqUrl}" style="color: #6b7280; text-decoration: none;">
            View RFQ Details
          </a>
        </div>
        
        <p style="color: #6b7280; font-size: 14px;">
          Please respond by ${deadlineText} to be considered for this project.
        </p>
      </div>
    `;
  }

  /**
   * Generate HTML for deadline extended email
   */
  static generateDeadlineExtendedHTML(rfq: RFQ, newDeadline: Date, rfqUrl: string, _additionalData?: Record<string, unknown>): string {
    const deadlineText = this.formatDeadline(newDeadline);
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">RFQ Deadline Extended</h2>
        
        <p>The response deadline for RFQ "${rfq.title}" has been extended.</p>
        
        <div style="background-color: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #059669;">
          <h3 style="margin-top: 0;">New Deadline:</h3>
          <p style="font-size: 18px; margin: 0; color: #059669;">
            <strong>${deadlineText}</strong>
          </p>
        </div>
        
        <p>You now have additional time to prepare and submit your response.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${rfqUrl}" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View RFQ
          </a>
        </div>
      </div>
    `;
  }

  /**
   * Generate HTML for cancelled RFQ email
   */
  static generateCancelledHTML(rfq: RFQ, additionalData?: Record<string, unknown>): string {
    const reason = (additionalData?.reason as string | undefined) ?? 'No reason provided';
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">RFQ Cancelled</h2>
        
        <p>We regret to inform you that RFQ "${rfq.title}" has been cancelled.</p>
        
        <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
          <h3 style="margin-top: 0;">Cancellation Reason:</h3>
          <p style="margin: 0;">${reason}</p>
        </div>
        
        <p>Thank you for your interest in this project. We apologize for any inconvenience caused.</p>
        
        <p style="color: #6b7280; font-size: 14px;">
          We will contact you about future opportunities that may be suitable for your organization.
        </p>
      </div>
    `;
  }

  /**
   * Generate HTML for awarded RFQ email
   */
  static generateAwardedHTML(rfq: RFQ, rfqUrl: string, additionalData?: Record<string, unknown>): string {
    const isWinner = (additionalData?.isWinner as boolean | undefined) ?? false;
    const winnerName = (additionalData?.winnerName as string | undefined) ?? 'the selected supplier';
    
    if (isWinner) {
      return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #059669;">Congratulations! RFQ Awarded to You</h2>
          
          <p>We are pleased to inform you that your response to RFQ "${rfq.title}" has been selected.</p>
          
          <div style="background-color: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #059669;">
            <h3 style="margin-top: 0;">Next Steps:</h3>
            <ul>
              <li>You will be contacted by our procurement team within 2 business days</li>
              <li>Please prepare any required documentation</li>
              <li>A purchase order will be issued shortly</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${rfqUrl}" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              View Award Details
            </a>
          </div>
          
          <p>Thank you for your participation and we look forward to working with you.</p>
        </div>
      `;
    } else {
      return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6b7280;">RFQ Award Decision: ${rfq.title}</h2>
          
          <p>Thank you for your response to RFQ "${rfq.title}".</p>
          
          <p>After careful evaluation, we have decided to award this project to ${winnerName}.</p>
          
          <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;">
              We appreciate the time and effort you invested in preparing your response. 
              Your proposal was thoroughly reviewed and considered.
            </p>
          </div>
          
          <p>We hope to work with you on future opportunities and will keep your organization in mind for similar projects.</p>
          
          <p style="color: #6b7280; font-size: 14px;">
            Thank you for your continued partnership and interest in our projects.
          </p>
        </div>
      `;
    }
  }

  /**
   * Generate HTML for reminder email
   */
  static generateReminderHTML(rfq: RFQ, hoursRemaining: number, responseUrl: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">RFQ Response Reminder</h2>
        
        <p>This is a reminder that your response to RFQ "${rfq.title}" is due soon.</p>
        
        <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
          <h3 style="margin-top: 0;">Time Remaining:</h3>
          <p style="font-size: 24px; margin: 0; color: #dc2626;">
            <strong>${hoursRemaining} hours</strong>
          </p>
        </div>
        
        <p>Don't miss this opportunity! Submit your response now to be considered for this project.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${responseUrl}" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Submit Response Now
          </a>
        </div>
        
        <p style="color: #6b7280; font-size: 14px;">
          Late responses may not be considered. Please ensure your submission is complete and submitted on time.
        </p>
      </div>
    `;
  }

  /**
   * Generate HTML for response confirmation email
   */
  static generateResponseConfirmationHTML(rfq: RFQ, additionalData?: Record<string, unknown>): string {
    const responseId = (additionalData?.responseId as string | undefined) ?? 'N/A';
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Response Received - Thank You!</h2>
        
        <p>Thank you for submitting your response to RFQ "${rfq.title}".</p>
        
        <div style="background-color: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #059669;">
          <h3 style="margin-top: 0;">Submission Details:</h3>
          <ul style="list-style: none; padding: 0;">
            <li><strong>RFQ:</strong> ${rfq.title}</li>
            <li><strong>Response ID:</strong> ${responseId}</li>
            <li><strong>Submitted:</strong> ${new Date().toLocaleString()}</li>
          </ul>
        </div>
        
        <p>Your response is now being evaluated by our procurement team. We will contact you with our decision soon.</p>
        
        <p style="color: #6b7280; font-size: 14px;">
          If you need to make any changes to your response, please contact us immediately.
        </p>
      </div>
    `;
  }

  /**
   * Format deadline for display
   */
  private static formatDeadline(deadline: Date): string {
    return formatDisplayDateTime(deadline);
  }
}