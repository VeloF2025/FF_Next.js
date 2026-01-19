/**
 * Ticketing Module - WhatsApp Notification Templates
 * 🟢 WORKING: Pre-defined message templates for WhatsApp notifications
 *
 * Professional, clear message templates for different notification types
 * with variable substitution support.
 *
 * Templates support variable replacement using {{variable_name}} syntax.
 */

import type { NotificationTemplate, NotificationVariables } from '../types/whatsapp';
import { NotificationUseCase } from '../types/whatsapp';

/**
 * WhatsApp notification templates for all use cases
 * 🟢 WORKING: Complete set of professional templates
 */
export const WHATSAPP_TEMPLATES: Record<NotificationUseCase, NotificationTemplate> = {
  // ========================================================================
  // Ticket Assignment
  // ========================================================================
  [NotificationUseCase.TICKET_ASSIGNED]: {
    id: NotificationUseCase.TICKET_ASSIGNED,
    name: 'Ticket Assignment',
    description: 'Notification sent when a ticket is assigned to a technician or contractor',
    template: `Hi {{assignee_name}},

You have been assigned ticket {{ticket_uid}}.

Title: {{ticket_title}}
DR Number: {{dr_number}}

Please review the details and take action as required.`,
    variables: ['assignee_name', 'ticket_uid', 'dr_number', 'ticket_title'],
    use_case: NotificationUseCase.TICKET_ASSIGNED,
  },

  // ========================================================================
  // QA Rejection
  // ========================================================================
  [NotificationUseCase.QA_REJECTED]: {
    id: NotificationUseCase.QA_REJECTED,
    name: 'QA Rejection',
    description: 'Notification sent when QA rejects a ticket submission',
    template: `Hi {{assignee_name}},

Ticket {{ticket_uid}} has been rejected by QA.

Reason: {{rejection_reason}}

Please review the feedback, make the necessary corrections, and resubmit for QA approval.`,
    variables: ['assignee_name', 'ticket_uid', 'rejection_reason'],
    use_case: NotificationUseCase.QA_REJECTED,
  },

  // ========================================================================
  // QA Approval
  // ========================================================================
  [NotificationUseCase.QA_APPROVED]: {
    id: NotificationUseCase.QA_APPROVED,
    name: 'QA Approval',
    description: 'Notification sent when QA approves a ticket',
    template: `Hi {{assignee_name}},

Great work! Ticket {{ticket_uid}} has been approved by QA.

The ticket is now ready for handover to maintenance.`,
    variables: ['assignee_name', 'ticket_uid'],
    use_case: NotificationUseCase.QA_APPROVED,
  },

  // ========================================================================
  // Ticket Closure
  // ========================================================================
  [NotificationUseCase.TICKET_CLOSED]: {
    id: NotificationUseCase.TICKET_CLOSED,
    name: 'Ticket Closed',
    description: 'Notification sent when a ticket is closed',
    template: `Hi {{assignee_name}},

Ticket {{ticket_uid}} has been successfully closed.

Thank you for your service and contribution to completing this work.`,
    variables: ['assignee_name', 'ticket_uid'],
    use_case: NotificationUseCase.TICKET_CLOSED,
  },

  // ========================================================================
  // SLA Warning
  // ========================================================================
  [NotificationUseCase.SLA_WARNING]: {
    id: NotificationUseCase.SLA_WARNING,
    name: 'SLA Warning',
    description: 'Notification sent when a ticket is approaching its SLA deadline',
    template: `⚠️ SLA Warning

Ticket {{ticket_uid}} is approaching its SLA deadline.

Due: {{sla_due_time}}
Assignee: {{assignee_name}}

Please prioritize this ticket to avoid SLA breach.`,
    variables: ['ticket_uid', 'sla_due_time', 'assignee_name'],
    use_case: NotificationUseCase.SLA_WARNING,
  },

  // ========================================================================
  // Risk Acceptance Expiring
  // ========================================================================
  [NotificationUseCase.RISK_EXPIRING]: {
    id: NotificationUseCase.RISK_EXPIRING,
    name: 'Risk Acceptance Expiring',
    description: 'Notification sent when a conditional QA approval risk is expiring',
    template: `⚠️ Risk Acceptance Expiring

Ticket {{ticket_uid}} has a risk acceptance that is expiring on {{expiry_date}}.

Risk: {{risk_description}}

Please take action to resolve the identified risk before the expiry date.`,
    variables: ['ticket_uid', 'expiry_date', 'risk_description'],
    use_case: NotificationUseCase.RISK_EXPIRING,
  },

  // ========================================================================
  // Escalation Created
  // ========================================================================
  [NotificationUseCase.ESCALATION_CREATED]: {
    id: NotificationUseCase.ESCALATION_CREATED,
    name: 'Escalation Created',
    description: 'Notification sent when a repeat fault triggers an escalation',
    template: `🚨 Escalation Created

Infrastructure escalation ticket {{ticket_uid}} has been created due to repeat faults.

Scope: {{scope_type}} {{scope_value}}
Fault Count: {{fault_count}} incidents

This requires immediate investigation to identify and resolve the root cause.`,
    variables: ['ticket_uid', 'scope_type', 'scope_value', 'fault_count'],
    use_case: NotificationUseCase.ESCALATION_CREATED,
  },

  // ========================================================================
  // Handover Complete
  // ========================================================================
  [NotificationUseCase.HANDOVER_COMPLETE]: {
    id: NotificationUseCase.HANDOVER_COMPLETE,
    name: 'Handover Complete',
    description: 'Notification sent when a ticket handover is completed',
    template: `✓ Handover Complete

Ticket {{ticket_uid}} has been successfully handed over.

Handover: {{handover_type}}
From: {{from_owner}}
To: {{to_owner}}

All documentation and evidence have been transferred and locked.`,
    variables: ['ticket_uid', 'handover_type', 'from_owner', 'to_owner'],
    use_case: NotificationUseCase.HANDOVER_COMPLETE,
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get template by notification use case
 * 🟢 WORKING: Retrieves template for a specific use case
 *
 * @param useCase - Notification use case
 * @returns NotificationTemplate
 */
export function getTemplate(useCase: NotificationUseCase): NotificationTemplate {
  return WHATSAPP_TEMPLATES[useCase];
}

/**
 * Get template by ID string
 * 🟢 WORKING: Retrieves template by string ID (case-insensitive)
 *
 * @param id - Template ID string
 * @returns NotificationTemplate or undefined if not found
 */
export function getTemplateById(id: string): NotificationTemplate | undefined {
  const useCase = id as NotificationUseCase;
  return WHATSAPP_TEMPLATES[useCase];
}

/**
 * Get all template IDs
 * 🟢 WORKING: Returns array of all template IDs
 *
 * @returns Array of NotificationUseCase values
 */
export function getAllTemplateIds(): NotificationUseCase[] {
  return Object.keys(WHATSAPP_TEMPLATES) as NotificationUseCase[];
}

/**
 * Render template with variable substitution
 * 🟢 WORKING: Replaces {{variable}} placeholders with actual values
 *
 * Supports any number of variables. Missing variables are replaced with empty string.
 *
 * @param template - Template string with {{variable}} placeholders
 * @param variables - Object with variable values
 * @returns Rendered message string
 *
 * @example
 * ```typescript
 * const message = renderTemplate(
 *   'Hi {{name}}, ticket {{ticket_uid}} assigned.',
 *   { name: 'John', ticket_uid: 'FT123' }
 * );
 * // Returns: "Hi John, ticket FT123 assigned."
 * ```
 */
export function renderTemplate(
  template: string,
  variables: NotificationVariables
): string {
  let rendered = template;

  // Replace all {{variable}} placeholders with values
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(placeholder, value ?? '');
  });

  // Replace any remaining unmatched variables with empty string
  rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');

  return rendered;
}

/**
 * Validate template variables
 * 🟢 WORKING: Checks if all required variables are present
 *
 * @param template - NotificationTemplate to validate
 * @param variables - Variable values to check
 * @returns Validation result with missing variables list
 *
 * @example
 * ```typescript
 * const result = validateTemplateVariables(
 *   WHATSAPP_TEMPLATES[NotificationUseCase.TICKET_ASSIGNED],
 *   { assignee_name: 'John', ticket_uid: 'FT123' }
 * );
 * // Returns: { isValid: false, missingVariables: ['dr_number', 'ticket_title'] }
 * ```
 */
export function validateTemplateVariables(
  template: NotificationTemplate,
  variables: NotificationVariables
): {
  isValid: boolean;
  missingVariables: string[];
} {
  const missingVariables: string[] = [];

  // Check each required variable
  template.variables.forEach((varName) => {
    if (variables[varName] === undefined || variables[varName] === null || variables[varName] === '') {
      missingVariables.push(varName);
    }
  });

  return {
    isValid: missingVariables.length === 0,
    missingVariables,
  };
}

/**
 * Get template variables list
 * 🟢 WORKING: Returns list of required variables for a template
 *
 * @param useCase - Notification use case
 * @returns Array of required variable names
 */
export function getTemplateVariables(useCase: NotificationUseCase): string[] {
  return WHATSAPP_TEMPLATES[useCase].variables;
}

/**
 * Check if template exists
 * 🟢 WORKING: Validates if a template ID exists
 *
 * @param id - Template ID to check
 * @returns true if template exists
 */
export function hasTemplate(id: string): boolean {
  return id in WHATSAPP_TEMPLATES;
}

/**
 * Render template by use case
 * 🟢 WORKING: Convenience function to get and render template in one call
 *
 * @param useCase - Notification use case
 * @param variables - Variable values
 * @returns Rendered message string
 *
 * @example
 * ```typescript
 * const message = renderTemplateByUseCase(
 *   NotificationUseCase.TICKET_ASSIGNED,
 *   { assignee_name: 'John', ticket_uid: 'FT123', dr_number: 'DR456', ticket_title: 'Install' }
 * );
 * ```
 */
export function renderTemplateByUseCase(
  useCase: NotificationUseCase,
  variables: NotificationVariables
): string {
  const template = getTemplate(useCase);
  return renderTemplate(template.template, variables);
}

/**
 * Get template preview
 * 🟢 WORKING: Returns template with placeholder text for preview
 *
 * @param useCase - Notification use case
 * @returns Template with example placeholder values
 */
export function getTemplatePreview(useCase: NotificationUseCase): string {
  const template = getTemplate(useCase);

  // Create example variables based on variable names
  const exampleVariables: NotificationVariables = {};

  template.variables.forEach((varName) => {
    switch (varName) {
      case 'ticket_uid':
        exampleVariables[varName] = 'FT406824';
        break;
      case 'assignee_name':
        exampleVariables[varName] = 'John Doe';
        break;
      case 'contractor_name':
        exampleVariables[varName] = 'ABC Contractors';
        break;
      case 'dr_number':
        exampleVariables[varName] = 'DR12345';
        break;
      case 'ticket_title':
        exampleVariables[varName] = 'Fiber installation required';
        break;
      case 'rejection_reason':
        exampleVariables[varName] = 'Missing photos for steps 5 and 7';
        break;
      case 'sla_due_time':
        exampleVariables[varName] = '2025-12-27 15:00';
        break;
      case 'risk_description':
        exampleVariables[varName] = 'Minor cable bend exceeds recommended radius';
        break;
      case 'expiry_date':
        exampleVariables[varName] = '2025-12-30';
        break;
      case 'scope_type':
        exampleVariables[varName] = 'PON';
        break;
      case 'scope_value':
        exampleVariables[varName] = 'PON-456';
        break;
      case 'fault_count':
        exampleVariables[varName] = '5';
        break;
      case 'handover_type':
        exampleVariables[varName] = 'QA to Maintenance';
        break;
      case 'from_owner':
        exampleVariables[varName] = 'QA Team';
        break;
      case 'to_owner':
        exampleVariables[varName] = 'Maintenance Team';
        break;
      default:
        exampleVariables[varName] = `[${varName}]`;
    }
  });

  return renderTemplate(template.template, exampleVariables);
}
