/**
 * WhatsApp Templates Tests
 * 🟢 WORKING: Test suite for WhatsApp notification templates
 *
 * Tests template structure, variable replacement, and message formatting
 * for all notification types.
 */

import { describe, it, expect } from 'vitest';
import {
  WHATSAPP_TEMPLATES,
  getTemplate,
  renderTemplate,
  validateTemplateVariables,
  getAllTemplateIds,
  getTemplateById,
} from '../../constants/whatsappTemplates';
import { NotificationUseCase } from '../../types/whatsapp';

describe('WhatsApp Templates', () => {
  describe('Template Structure', () => {
    it('should have templates for all notification use cases', () => {
      const useCases = Object.values(NotificationUseCase);

      useCases.forEach((useCase) => {
        const template = WHATSAPP_TEMPLATES[useCase];
        expect(template).toBeDefined();
        expect(template.id).toBe(useCase);
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.template).toBeTruthy();
        expect(template.use_case).toBe(useCase);
        expect(Array.isArray(template.variables)).toBe(true);
      });
    });

    it('should have unique template IDs', () => {
      const ids = Object.values(WHATSAPP_TEMPLATES).map(t => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have all required fields for each template', () => {
      Object.values(WHATSAPP_TEMPLATES).forEach((template) => {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('template');
        expect(template).toHaveProperty('variables');
        expect(template).toHaveProperty('use_case');
      });
    });
  });

  describe('Assignment Notification Template', () => {
    it('should have correct template structure for ticket_assigned', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.TICKET_ASSIGNED];

      expect(template.id).toBe(NotificationUseCase.TICKET_ASSIGNED);
      expect(template.name).toBe('Ticket Assignment');
      expect(template.template).toContain('{{assignee_name}}');
      expect(template.template).toContain('{{ticket_uid}}');
      expect(template.template).toContain('{{dr_number}}');
      expect(template.variables).toEqual(['assignee_name', 'ticket_uid', 'dr_number', 'ticket_title']);
    });

    it('should render assignment notification correctly', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.TICKET_ASSIGNED];
      const rendered = renderTemplate(template.template, {
        assignee_name: 'John Doe',
        ticket_uid: 'FT406824',
        dr_number: 'DR12345',
        ticket_title: 'Fiber installation required',
      });

      expect(rendered).toContain('John Doe');
      expect(rendered).toContain('FT406824');
      expect(rendered).toContain('DR12345');
      expect(rendered).toContain('Fiber installation required');
      expect(rendered).not.toContain('{{');
      expect(rendered).not.toContain('}}');
    });
  });

  describe('QA Rejection Notification Template', () => {
    it('should have correct template structure for qa_rejected', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.QA_REJECTED];

      expect(template.id).toBe(NotificationUseCase.QA_REJECTED);
      expect(template.name).toBe('QA Rejection');
      expect(template.template).toContain('{{ticket_uid}}');
      expect(template.template).toContain('{{rejection_reason}}');
      expect(template.variables).toContain('ticket_uid');
      expect(template.variables).toContain('rejection_reason');
    });

    it('should render QA rejection notification correctly', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.QA_REJECTED];
      const rendered = renderTemplate(template.template, {
        ticket_uid: 'FT406824',
        rejection_reason: 'Missing photos for steps 5 and 7',
        assignee_name: 'John Doe',
      });

      expect(rendered).toContain('FT406824');
      expect(rendered).toContain('Missing photos for steps 5 and 7');
      expect(rendered).not.toContain('{{');
    });
  });

  describe('QA Approval Notification Template', () => {
    it('should have correct template structure for qa_approved', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.QA_APPROVED];

      expect(template.id).toBe(NotificationUseCase.QA_APPROVED);
      expect(template.name).toBe('QA Approval');
      expect(template.template).toContain('{{ticket_uid}}');
      expect(template.variables).toContain('ticket_uid');
    });

    it('should render QA approval notification correctly', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.QA_APPROVED];
      const rendered = renderTemplate(template.template, {
        ticket_uid: 'FT406824',
        assignee_name: 'John Doe',
      });

      expect(rendered).toContain('FT406824');
      expect(rendered).toContain('approved');
      expect(rendered).not.toContain('{{');
    });
  });

  describe('Ticket Closure Notification Template', () => {
    it('should have correct template structure for ticket_closed', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.TICKET_CLOSED];

      expect(template.id).toBe(NotificationUseCase.TICKET_CLOSED);
      expect(template.name).toBe('Ticket Closed');
      expect(template.template).toContain('{{ticket_uid}}');
      expect(template.variables).toContain('ticket_uid');
    });

    it('should render ticket closure notification correctly', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.TICKET_CLOSED];
      const rendered = renderTemplate(template.template, {
        ticket_uid: 'FT406824',
        assignee_name: 'John Doe',
      });

      expect(rendered).toContain('FT406824');
      expect(rendered).toContain('closed');
      expect(rendered).not.toContain('{{');
    });
  });

  describe('SLA Warning Notification Template', () => {
    it('should have correct template structure for sla_warning', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.SLA_WARNING];

      expect(template.id).toBe(NotificationUseCase.SLA_WARNING);
      expect(template.name).toBe('SLA Warning');
      expect(template.template).toContain('{{ticket_uid}}');
      expect(template.template).toContain('{{sla_due_time}}');
      expect(template.variables).toContain('ticket_uid');
      expect(template.variables).toContain('sla_due_time');
    });

    it('should render SLA warning notification correctly', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.SLA_WARNING];
      const rendered = renderTemplate(template.template, {
        ticket_uid: 'FT406824',
        sla_due_time: '2025-12-27 15:00',
        assignee_name: 'John Doe',
      });

      expect(rendered).toContain('FT406824');
      expect(rendered).toContain('2025-12-27 15:00');
      expect(rendered).toMatch(/SLA|due/i);
      expect(rendered).not.toContain('{{');
    });
  });

  describe('Risk Expiry Notification Template', () => {
    it('should have correct template structure for risk_expiring', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.RISK_EXPIRING];

      expect(template.id).toBe(NotificationUseCase.RISK_EXPIRING);
      expect(template.name).toBe('Risk Acceptance Expiring');
      expect(template.template).toContain('{{ticket_uid}}');
      expect(template.template).toContain('{{expiry_date}}');
      expect(template.template).toContain('{{risk_description}}');
      expect(template.variables).toContain('risk_description');
    });

    it('should render risk expiry notification correctly', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.RISK_EXPIRING];
      const rendered = renderTemplate(template.template, {
        ticket_uid: 'FT406824',
        expiry_date: '2025-12-30',
        risk_description: 'Minor cable bend exceeds recommended radius',
      });

      expect(rendered).toContain('FT406824');
      expect(rendered).toContain('2025-12-30');
      expect(rendered).toContain('Minor cable bend exceeds recommended radius');
      expect(rendered).not.toContain('{{');
    });
  });

  describe('Escalation Created Notification Template', () => {
    it('should have correct template structure for escalation_created', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.ESCALATION_CREATED];

      expect(template.id).toBe(NotificationUseCase.ESCALATION_CREATED);
      expect(template.name).toBe('Escalation Created');
      expect(template.template).toBeTruthy();
      expect(template.variables.length).toBeGreaterThan(0);
    });

    it('should render escalation notification correctly', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.ESCALATION_CREATED];
      const variables = {
        ticket_uid: 'FT999999',
        scope_type: 'PON',
        scope_value: 'PON-456',
        fault_count: '5',
      };

      const rendered = renderTemplate(template.template, variables);

      expect(rendered).not.toContain('{{');
      expect(rendered).toContain('FT999999');
    });
  });

  describe('Handover Complete Notification Template', () => {
    it('should have correct template structure for handover_complete', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.HANDOVER_COMPLETE];

      expect(template.id).toBe(NotificationUseCase.HANDOVER_COMPLETE);
      expect(template.name).toBe('Handover Complete');
      expect(template.template).toBeTruthy();
      expect(template.variables.length).toBeGreaterThan(0);
    });

    it('should render handover notification correctly', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.HANDOVER_COMPLETE];
      const variables = {
        ticket_uid: 'FT406824',
        handover_type: 'QA to Maintenance',
        from_owner: 'QA Team',
        to_owner: 'Maintenance Team',
      };

      const rendered = renderTemplate(template.template, variables);

      expect(rendered).not.toContain('{{');
      expect(rendered).toContain('FT406824');
    });
  });

  describe('Variable Replacement', () => {
    it('should replace all variables in template', () => {
      const template = 'Hello {{name}}, your ticket {{ticket_uid}} is {{status}}.';
      const variables = {
        name: 'John',
        ticket_uid: 'FT123',
        status: 'approved',
      };

      const rendered = renderTemplate(template, variables);

      expect(rendered).toBe('Hello John, your ticket FT123 is approved.');
    });

    it('should handle missing variables gracefully', () => {
      const template = 'Hello {{name}}, your ticket {{ticket_uid}} is ready.';
      const variables = {
        name: 'John',
      };

      const rendered = renderTemplate(template, variables);

      // Missing variables should remain as placeholders or be replaced with empty string
      expect(rendered).toContain('John');
    });

    it('should handle extra variables gracefully', () => {
      const template = 'Ticket {{ticket_uid}} assigned.';
      const variables = {
        ticket_uid: 'FT123',
        extra_var: 'extra',
        another_var: 'another',
      };

      const rendered = renderTemplate(template, variables);

      expect(rendered).toBe('Ticket FT123 assigned.');
    });

    it('should handle special characters in variable values', () => {
      const template = 'Reason: {{reason}}';
      const variables = {
        reason: 'Missing photos & incomplete notes (steps 5-7)',
      };

      const rendered = renderTemplate(template, variables);

      expect(rendered).toContain('Missing photos & incomplete notes (steps 5-7)');
    });

    it('should handle empty string variables', () => {
      const template = 'Status: {{status}}';
      const variables = {
        status: '',
      };

      const rendered = renderTemplate(template, variables);

      expect(rendered).toBe('Status: ');
    });
  });

  describe('Template Validation', () => {
    it('should validate required variables are present', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.TICKET_ASSIGNED];
      const variables = {
        assignee_name: 'John Doe',
        ticket_uid: 'FT406824',
        dr_number: 'DR12345',
        ticket_title: 'Test',
      };

      const result = validateTemplateVariables(template, variables);

      expect(result.isValid).toBe(true);
      expect(result.missingVariables).toHaveLength(0);
    });

    it('should detect missing required variables', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.TICKET_ASSIGNED];
      const variables = {
        assignee_name: 'John Doe',
        // Missing ticket_uid, dr_number, ticket_title
      };

      const result = validateTemplateVariables(template, variables);

      expect(result.isValid).toBe(false);
      expect(result.missingVariables).toContain('ticket_uid');
      expect(result.missingVariables).toContain('dr_number');
    });

    it('should return empty array for valid variables', () => {
      const template = WHATSAPP_TEMPLATES[NotificationUseCase.QA_APPROVED];
      const variables = {
        ticket_uid: 'FT406824',
        assignee_name: 'John',
      };

      const result = validateTemplateVariables(template, variables);

      expect(result.isValid).toBe(true);
      expect(result.missingVariables).toEqual([]);
    });
  });

  describe('Helper Functions', () => {
    it('should get template by use case', () => {
      const template = getTemplate(NotificationUseCase.TICKET_ASSIGNED);

      expect(template).toBeDefined();
      expect(template.id).toBe(NotificationUseCase.TICKET_ASSIGNED);
    });

    it('should get template by ID string', () => {
      const template = getTemplateById('ticket_assigned');

      expect(template).toBeDefined();
      expect(template?.id).toBe(NotificationUseCase.TICKET_ASSIGNED);
    });

    it('should return undefined for invalid template ID', () => {
      const template = getTemplateById('invalid_template_id');

      expect(template).toBeUndefined();
    });

    it('should get all template IDs', () => {
      const ids = getAllTemplateIds();

      expect(ids).toContain(NotificationUseCase.TICKET_ASSIGNED);
      expect(ids).toContain(NotificationUseCase.QA_REJECTED);
      expect(ids).toContain(NotificationUseCase.QA_APPROVED);
      expect(ids).toContain(NotificationUseCase.TICKET_CLOSED);
      expect(ids).toContain(NotificationUseCase.SLA_WARNING);
      expect(ids).toContain(NotificationUseCase.RISK_EXPIRING);
      expect(ids).toContain(NotificationUseCase.ESCALATION_CREATED);
      expect(ids).toContain(NotificationUseCase.HANDOVER_COMPLETE);
      expect(ids.length).toBe(8);
    });
  });

  describe('Template Professionalism', () => {
    it('should have professional and clear messages', () => {
      Object.values(WHATSAPP_TEMPLATES).forEach((template) => {
        // Should not contain informal language
        expect(template.template.toLowerCase()).not.toMatch(/lol|haha|wtf|omg/);

        // Should not contain all caps (except for acronyms in context)
        const capsWords = template.template.match(/\b[A-Z]{4,}\b/g) || [];
        const allowedCaps = ['URGENT', 'CRITICAL'];
        capsWords.forEach((word) => {
          if (!allowedCaps.includes(word)) {
            expect(template.template).not.toContain(word);
          }
        });

        // Should have proper punctuation
        expect(template.template.trim()).toMatch(/[.!?]$/);
      });
    });

    it('should use appropriate greeting and tone', () => {
      const assignmentTemplate = WHATSAPP_TEMPLATES[NotificationUseCase.TICKET_ASSIGNED];
      expect(assignmentTemplate.template).toMatch(/Hi|Hello|Dear/);
    });

    it('should include actionable information', () => {
      const qaRejectedTemplate = WHATSAPP_TEMPLATES[NotificationUseCase.QA_REJECTED];
      // Should include what to do next
      expect(qaRejectedTemplate.template.toLowerCase()).toMatch(/please|review|resubmit|action/);
    });
  });

  describe('Template Length', () => {
    it('should have reasonable message length (not too long for WhatsApp)', () => {
      Object.values(WHATSAPP_TEMPLATES).forEach((template) => {
        // WhatsApp has no hard limit, but messages should be concise
        // Assuming max ~500 chars for template (before variable replacement)
        expect(template.template.length).toBeLessThan(500);
      });
    });

    it('should have descriptive but concise template names', () => {
      Object.values(WHATSAPP_TEMPLATES).forEach((template) => {
        expect(template.name.length).toBeGreaterThan(5);
        expect(template.name.length).toBeLessThan(50);
      });
    });

    it('should have helpful descriptions', () => {
      Object.values(WHATSAPP_TEMPLATES).forEach((template) => {
        expect(template.description.length).toBeGreaterThan(10);
        expect(template.description.length).toBeLessThan(200);
      });
    });
  });
});
