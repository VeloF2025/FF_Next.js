/**
 * Email Templates
 * HTML email template generation for RFQ notifications
 */

import { RFQ } from '@/types/procurement.types';

export class RFQEmailTemplates {
  private static readonly BASE_URL = typeof window !== 'undefined' 
    ? window.location.origin 
    : process.env.NEXT_PUBLIC_BASE_URL || 'https://app.fibreflow.com';

  /**
   * Generate email template for issued RFQ
   */
  static generateIssuedEmailTemplate(rfq: RFQ, rfqUrl?: string): string {
    const url = rfqUrl || `${this.BASE_URL}/procurement/rfq/${rfq.id}`;
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="color: #333; margin: 0;">New Request for Quote</h2>
        </div>
        <div style="background-color: white; padding: 20px; border: 1px solid #e9ecef;">
          <p style="color: #666; font-size: 16px;">You have been invited to submit a quote for:</p>
          
          <h3 style="color: #007bff; margin: 20px 0 10px 0;">${rfq.title}</h3>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>RFQ Number:</strong> ${rfq.rfqNumber}</p>
            <p style="margin: 5px 0;"><strong>Project:</strong> ${rfq.projectId}</p>
            <p style="margin: 5px 0;"><strong>Response Deadline:</strong> ${rfq.responseDeadline?.toISOString().split('T')[0]}</p>
          </div>
          
          <p style="color: #666; line-height: 1.5;"><strong>Description:</strong> ${rfq.description}</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${url}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
              View RFQ Details
            </a>
          </div>
        </div>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 0 0 8px 8px; text-align: center;">
          <p style="color: #6c757d; font-size: 14px; margin: 0;">FibreFlow Procurement System</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate email template for deadline extension
   */
  static generateDeadlineExtendedTemplate(
    rfq: RFQ, 
    rfqUrl: string, 
    newDeadline?: Date, 
    reason?: string
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px 8px 0 0; border-left: 4px solid #ffc107;">
          <h2 style="color: #856404; margin: 0;">RFQ Deadline Extended</h2>
        </div>
        <div style="background-color: white; padding: 20px; border: 1px solid #e9ecef;">
          <p style="color: #666; font-size: 16px;">The response deadline has been extended for:</p>
          
          <h3 style="color: #007bff; margin: 20px 0 10px 0;">${rfq.title}</h3>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>RFQ Number:</strong> ${rfq.rfqNumber}</p>
            <p style="margin: 5px 0;"><strong>Original Deadline:</strong> ${rfq.responseDeadline?.toISOString().split('T')[0]}</p>
            <p style="margin: 5px 0; color: #28a745;"><strong>New Deadline:</strong> ${newDeadline?.toISOString().split('T')[0] || 'TBD'}</p>
            ${reason ? `<p style="margin: 5px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${rfqUrl}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
              View Updated RFQ
            </a>
          </div>
        </div>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 0 0 8px 8px; text-align: center;">
          <p style="color: #6c757d; font-size: 14px; margin: 0;">FibreFlow Procurement System</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate email template for cancelled RFQ
   */
  static generateCancelledTemplate(rfq: RFQ, reason?: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px 8px 0 0; border-left: 4px solid #dc3545;">
          <h2 style="color: #721c24; margin: 0;">RFQ Cancelled</h2>
        </div>
        <div style="background-color: white; padding: 20px; border: 1px solid #e9ecef;">
          <p style="color: #666; font-size: 16px;">The following RFQ has been cancelled:</p>
          
          <h3 style="color: #dc3545; margin: 20px 0 10px 0;">${rfq.title}</h3>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>RFQ Number:</strong> ${rfq.rfqNumber}</p>
            <p style="margin: 5px 0;"><strong>Project:</strong> ${rfq.projectId}</p>
            ${reason ? `<p style="margin: 5px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
          </div>
          
          <p style="color: #666; line-height: 1.5;">
            We apologize for any inconvenience. If you have any questions, please contact the project manager.
          </p>
        </div>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 0 0 8px 8px; text-align: center;">
          <p style="color: #6c757d; font-size: 14px; margin: 0;">FibreFlow Procurement System</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate generic email template
   */
  static generateGenericTemplate(rfq: RFQ, subject: string, message: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="color: #333; margin: 0;">${subject}</h2>
        </div>
        <div style="background-color: white; padding: 20px; border: 1px solid #e9ecef;">
          <h3 style="color: #007bff; margin: 20px 0 10px 0;">${rfq.title}</h3>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>RFQ Number:</strong> ${rfq.rfqNumber}</p>
            <p style="margin: 5px 0;"><strong>Project:</strong> ${rfq.projectId}</p>
          </div>
          
          <div style="color: #666; line-height: 1.5;">${message}</div>
        </div>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 0 0 8px 8px; text-align: center;">
          <p style="color: #6c757d; font-size: 14px; margin: 0;">FibreFlow Procurement System</p>
        </div>
      </div>
    `;
  }
}