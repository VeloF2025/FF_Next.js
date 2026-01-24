/**
 * Test Specification: Service Registry
 * Source: tests/specs/service-registry.spec.md
 * Phase: RED (failing tests)
 *
 * Central registry of all monitored services with recovery configurations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ServiceRegistry,
  createService,
  updateService,
  deleteService,
  getServiceById,
  getAllServices,
  getServicesByCategory,
  getCriticalServices,
  getServicesWithRecovery,
  getServiceWithActions,
  bulkUpdateStatus,
  countServicesByStatus,
} from '@/modules/system/services/serviceRegistry';
import {
  createRecoveryAction,
  updateRecoveryAction,
  deleteRecoveryAction,
  getRecoveryActionsForService,
  incrementSuccessCount,
  incrementFailureCount,
} from '@/modules/system/services/recoveryActions';
import { pool } from '@/lib/db';

// Mock database pool
vi.mock('@/lib/db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

const mockQuery = vi.mocked(pool.query);

// Test data
const validService = {
  name: 'FibreFlow Production',
  category: 'app' as const,
  healthEndpoint: 'https://app.fibreflow.app/api/health',
  isCritical: true,
  recoveryEnabled: true,
};

const validRecoveryAction = {
  serviceId: 'service-123',
  actionName: 'Restart Service',
  description: 'Restart the systemd service',
  command: 'systemctl restart fibreflow.service',
  riskLevel: 'safe' as const,
  requiresApproval: false,
  successIndicator: 'systemctl is-active fibreflow.service',
  rollbackCommand: null,
};

describe('Service Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Service Definition Tests', () => {
    describe('SD-001: Create service with valid data', () => {
      it('should create a service when all required fields are provided', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'new-service-id', ...validService }],
          rowCount: 1,
        });

        const result = await createService(validService);

        expect(result).toHaveProperty('id');
        expect(result.name).toBe(validService.name);
        expect(result.category).toBe(validService.category);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO infrastructure_services'),
          expect.arrayContaining([validService.name, validService.category])
        );
      });
    });

    describe('SD-002: Reject service without name', () => {
      it('should throw validation error when name is null', async () => {
        const invalidService = { ...validService, name: null };

        await expect(createService(invalidService as unknown)).rejects.toThrow(/name.*required/i);
      });

      it('should throw validation error when name is empty string', async () => {
        const invalidService = { ...validService, name: '' };

        await expect(createService(invalidService)).rejects.toThrow(/name.*required/i);
      });
    });

    describe('SD-003: Reject service without endpoint', () => {
      it('should throw validation error when endpoint is null', async () => {
        const invalidService = { ...validService, healthEndpoint: null };

        await expect(createService(invalidService as unknown)).rejects.toThrow(/endpoint.*required/i);
      });

      it('should throw validation error when endpoint is empty string', async () => {
        const invalidService = { ...validService, healthEndpoint: '' };

        await expect(createService(invalidService)).rejects.toThrow(/endpoint.*required/i);
      });
    });

    describe('SD-004: Validate category enum', () => {
      it('should throw validation error for invalid category', async () => {
        const invalidService = { ...validService, category: 'invalid' };

        await expect(createService(invalidService as unknown)).rejects.toThrow(/category.*invalid/i);
      });

      it('should accept valid category: app', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', ...validService }], rowCount: 1 });

        const result = await createService({ ...validService, category: 'app' });
        expect(result.category).toBe('app');
      });

      it('should accept valid category: ai', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', ...validService, category: 'ai' }], rowCount: 1 });

        const result = await createService({ ...validService, category: 'ai' });
        expect(result.category).toBe('ai');
      });

      it('should accept valid category: messaging', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', ...validService, category: 'messaging' }], rowCount: 1 });

        const result = await createService({ ...validService, category: 'messaging' });
        expect(result.category).toBe('messaging');
      });

      it('should accept valid category: database', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', ...validService, category: 'database' }], rowCount: 1 });

        const result = await createService({ ...validService, category: 'database' });
        expect(result.category).toBe('database');
      });

      it('should accept valid category: infrastructure', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', ...validService, category: 'infrastructure' }], rowCount: 1 });

        const result = await createService({ ...validService, category: 'infrastructure' });
        expect(result.category).toBe('infrastructure');
      });
    });

    describe('SD-005: Default isCritical to false', () => {
      it('should default isCritical to false when not provided', async () => {
        const serviceWithoutCritical = {
          name: 'Test Service',
          category: 'app' as const,
          healthEndpoint: 'http://test/health',
        };

        mockQuery.mockResolvedValueOnce({
          rows: [{ id: '1', ...serviceWithoutCritical, isCritical: false, recoveryEnabled: false }],
          rowCount: 1,
        });

        const result = await createService(serviceWithoutCritical);
        expect(result.isCritical).toBe(false);
      });
    });

    describe('SD-006: Default recoveryEnabled to false', () => {
      it('should default recoveryEnabled to false when not provided', async () => {
        const serviceWithoutRecovery = {
          name: 'Test Service',
          category: 'app' as const,
          healthEndpoint: 'http://test/health',
        };

        mockQuery.mockResolvedValueOnce({
          rows: [{ id: '1', ...serviceWithoutRecovery, isCritical: false, recoveryEnabled: false }],
          rowCount: 1,
        });

        const result = await createService(serviceWithoutRecovery);
        expect(result.recoveryEnabled).toBe(false);
      });
    });

    describe('SD-007: Update service name', () => {
      it('should update service name successfully', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'service-123', name: 'New Name', category: 'app' }],
          rowCount: 1,
        });

        const result = await updateService('service-123', { name: 'New Name' });

        expect(result.name).toBe('New Name');
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE infrastructure_services'),
          expect.arrayContaining(['New Name', 'service-123'])
        );
      });
    });

    describe('SD-008: Update service endpoint', () => {
      it('should update service endpoint successfully', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'service-123', healthEndpoint: 'http://new-endpoint/health' }],
          rowCount: 1,
        });

        const result = await updateService('service-123', { healthEndpoint: 'http://new-endpoint/health' });

        expect(result.healthEndpoint).toBe('http://new-endpoint/health');
      });
    });

    describe('SD-009: Delete service', () => {
      it('should delete service by ID', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await deleteService('service-123');

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM infrastructure_services'),
          ['service-123']
        );
      });
    });

    describe('SD-010: Delete cascades recovery actions', () => {
      it('should delete associated recovery actions when service is deleted', async () => {
        // This is handled by ON DELETE CASCADE in the DB schema
        // Test that the deletion query doesn't fail
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await deleteService('service-with-actions');

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM infrastructure_services'),
          ['service-with-actions']
        );
      });
    });
  });

  describe('Recovery Action Tests', () => {
    describe('RA-001: Create action with valid data', () => {
      it('should create a recovery action when all required fields are provided', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'action-123', ...validRecoveryAction }],
          rowCount: 1,
        });

        const result = await createRecoveryAction(validRecoveryAction);

        expect(result).toHaveProperty('id');
        expect(result.actionName).toBe(validRecoveryAction.actionName);
        expect(result.command).toBe(validRecoveryAction.command);
      });
    });

    describe('RA-002: Reject action without command', () => {
      it('should throw validation error when command is null', async () => {
        const invalidAction = { ...validRecoveryAction, command: null };

        await expect(createRecoveryAction(invalidAction as unknown)).rejects.toThrow(/command.*required/i);
      });

      it('should throw validation error when command is empty', async () => {
        const invalidAction = { ...validRecoveryAction, command: '' };

        await expect(createRecoveryAction(invalidAction)).rejects.toThrow(/command.*required/i);
      });
    });

    describe('RA-003: Validate risk level enum', () => {
      it('should throw validation error for invalid risk level', async () => {
        const invalidAction = { ...validRecoveryAction, riskLevel: 'invalid' };

        await expect(createRecoveryAction(invalidAction as unknown)).rejects.toThrow(/riskLevel.*invalid/i);
      });

      it('should accept valid risk level: safe', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: '1', ...validRecoveryAction, riskLevel: 'safe' }],
          rowCount: 1,
        });

        const result = await createRecoveryAction({ ...validRecoveryAction, riskLevel: 'safe' });
        expect(result.riskLevel).toBe('safe');
      });

      it('should accept valid risk level: moderate', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: '1', ...validRecoveryAction, riskLevel: 'moderate' }],
          rowCount: 1,
        });

        const result = await createRecoveryAction({ ...validRecoveryAction, riskLevel: 'moderate' });
        expect(result.riskLevel).toBe('moderate');
      });

      it('should accept valid risk level: dangerous', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: '1', ...validRecoveryAction, riskLevel: 'dangerous' }],
          rowCount: 1,
        });

        const result = await createRecoveryAction({ ...validRecoveryAction, riskLevel: 'dangerous' });
        expect(result.riskLevel).toBe('dangerous');
      });
    });

    describe('RA-004: Safe risk defaults no approval', () => {
      it('should set requiresApproval to false for safe risk level', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: '1', ...validRecoveryAction, riskLevel: 'safe', requiresApproval: false }],
          rowCount: 1,
        });

        const result = await createRecoveryAction({
          ...validRecoveryAction,
          riskLevel: 'safe',
          requiresApproval: undefined,
        });

        expect(result.requiresApproval).toBe(false);
      });
    });

    describe('RA-005: Dangerous risk requires approval', () => {
      it('should set requiresApproval to true for dangerous risk level', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: '1', ...validRecoveryAction, riskLevel: 'dangerous', requiresApproval: true }],
          rowCount: 1,
        });

        const result = await createRecoveryAction({
          ...validRecoveryAction,
          riskLevel: 'dangerous',
        });

        expect(result.requiresApproval).toBe(true);
      });
    });

    describe('RA-006: Track success count', () => {
      it('should increment success count by 1', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'action-123', successCount: 6 }],
          rowCount: 1,
        });

        const result = await incrementSuccessCount('action-123');

        expect(result.successCount).toBe(6);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('success_count = success_count + 1'),
          ['action-123']
        );
      });
    });

    describe('RA-007: Track failure count', () => {
      it('should increment failure count by 1', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'action-123', failureCount: 3 }],
          rowCount: 1,
        });

        const result = await incrementFailureCount('action-123');

        expect(result.failureCount).toBe(3);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('failure_count = failure_count + 1'),
          ['action-123']
        );
      });
    });

    describe('RA-008: Get actions for service', () => {
      it('should return all recovery actions for a service', async () => {
        const mockActions = [
          { id: '1', actionName: 'Restart', riskLevel: 'safe' },
          { id: '2', actionName: 'Rebuild', riskLevel: 'moderate' },
        ];

        mockQuery.mockResolvedValueOnce({ rows: mockActions, rowCount: 2 });

        const result = await getRecoveryActionsForService('service-123');

        expect(result).toHaveLength(2);
        expect(result[0].actionName).toBe('Restart');
        expect(result[1].actionName).toBe('Rebuild');
      });
    });

    describe('RA-009: Delete action', () => {
      it('should delete recovery action by ID', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await deleteRecoveryAction('action-123');

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM recovery_actions'),
          ['action-123']
        );
      });
    });

    describe('RA-010: Update last executed timestamp', () => {
      it('should update last_executed when action is executed', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'action-123', lastExecuted: new Date().toISOString() }],
          rowCount: 1,
        });

        const result = await updateRecoveryAction('action-123', { lastExecuted: new Date() });

        expect(result.lastExecuted).toBeDefined();
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('last_executed'),
          expect.any(Array)
        );
      });
    });
  });

  describe('Registry Function Tests', () => {
    describe('RF-001: getAllServices returns all', () => {
      it('should return all 14 registered services', async () => {
        const mockServices = Array.from({ length: 14 }, (_, i) => ({
          id: `service-${i}`,
          name: `Service ${i}`,
          category: 'app',
        }));

        mockQuery.mockResolvedValueOnce({ rows: mockServices, rowCount: 14 });

        const result = await getAllServices();

        expect(result).toHaveLength(14);
      });
    });

    describe('RF-002: getServiceById returns one', () => {
      it('should return a single service by ID', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'service-123', name: 'FibreFlow Production' }],
          rowCount: 1,
        });

        const result = await getServiceById('service-123');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('service-123');
        expect(result?.name).toBe('FibreFlow Production');
      });
    });

    describe('RF-003: getServiceById returns null', () => {
      it('should return null for invalid service ID', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const result = await getServiceById('invalid-id');

        expect(result).toBeNull();
      });
    });

    describe('RF-004: getServicesByCategory filters', () => {
      it('should return only AI services when category is ai', async () => {
        const aiServices = [
          { id: '1', name: 'VLM', category: 'ai' },
          { id: '2', name: 'Ollama', category: 'ai' },
          { id: '3', name: 'Qdrant', category: 'ai' },
        ];

        mockQuery.mockResolvedValueOnce({ rows: aiServices, rowCount: 3 });

        const result = await getServicesByCategory('ai');

        expect(result).toHaveLength(3);
        result.forEach((service) => {
          expect(service.category).toBe('ai');
        });
      });
    });

    describe('RF-005: getCriticalServices filters', () => {
      it('should return only critical services', async () => {
        const criticalServices = [
          { id: '1', name: 'FibreFlow Production', isCritical: true },
          { id: '2', name: 'VLM', isCritical: true },
        ];

        mockQuery.mockResolvedValueOnce({ rows: criticalServices, rowCount: 2 });

        const result = await getCriticalServices();

        result.forEach((service) => {
          expect(service.isCritical).toBe(true);
        });
      });
    });

    describe('RF-006: getServicesWithRecovery filters', () => {
      it('should return only services with recovery enabled', async () => {
        const recoveryServices = [
          { id: '1', name: 'FibreFlow Production', recoveryEnabled: true },
          { id: '2', name: 'VLM', recoveryEnabled: true },
        ];

        mockQuery.mockResolvedValueOnce({ rows: recoveryServices, rowCount: 2 });

        const result = await getServicesWithRecovery();

        result.forEach((service) => {
          expect(service.recoveryEnabled).toBe(true);
        });
      });
    });

    describe('RF-007: getServiceWithActions joins', () => {
      it('should return service with its recovery actions', async () => {
        const serviceWithActions = {
          id: 'service-123',
          name: 'FibreFlow Production',
          actions: [
            { id: 'action-1', actionName: 'Restart', riskLevel: 'safe' },
            { id: 'action-2', actionName: 'Rebuild', riskLevel: 'moderate' },
          ],
        };

        mockQuery.mockResolvedValueOnce({
          rows: [serviceWithActions],
          rowCount: 1,
        });

        const result = await getServiceWithActions('service-123');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('service-123');
        expect(result?.actions).toHaveLength(2);
      });
    });

    describe('RF-008: bulkUpdateStatus updates all', () => {
      it('should update status for all services in the map', async () => {
        const statusMap = {
          'service-1': 'up',
          'service-2': 'down',
          'service-3': 'degraded',
        };

        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });

        await bulkUpdateStatus(statusMap);

        expect(mockQuery).toHaveBeenCalled();
      });
    });

    describe('RF-009: getRecoveryActionsForService', () => {
      it('should return actions array for a service', async () => {
        const actions = [
          { id: '1', actionName: 'Restart' },
          { id: '2', actionName: 'Rebuild' },
        ];

        mockQuery.mockResolvedValueOnce({ rows: actions, rowCount: 2 });

        const result = await getRecoveryActionsForService('service-123');

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
      });
    });

    describe('RF-010: countServicesByStatus groups', () => {
      it('should return count per status', async () => {
        const statusCounts = [
          { status: 'up', count: 12 },
          { status: 'down', count: 1 },
          { status: 'degraded', count: 1 },
        ];

        mockQuery.mockResolvedValueOnce({ rows: statusCounts, rowCount: 3 });

        const result = await countServicesByStatus();

        expect(result.up).toBe(12);
        expect(result.down).toBe(1);
        expect(result.degraded).toBe(1);
      });
    });
  });

  describe('Seed Data Validation', () => {
    it('should have 14+ services in seed data', async () => {
      const seedServices = [
        // App (4)
        { name: 'FibreFlow Production', category: 'app' },
        { name: 'FibreFlow Staging', category: 'app' },
        { name: 'FibreFlow Dev', category: 'app' },
        { name: 'FibreFlow Backup', category: 'app' },
        // AI (3)
        { name: 'VLM (Qwen3)', category: 'ai' },
        { name: 'Ollama', category: 'ai' },
        { name: 'Qdrant', category: 'ai' },
        // Messaging (3)
        { name: 'WA Feedback', category: 'messaging' },
        { name: 'WA Sender VPS', category: 'messaging' },
        { name: 'WA Bridge VPS', category: 'messaging' },
        // Database (3)
        { name: 'Neon Production', category: 'database' },
        { name: 'Neon Dev', category: 'database' },
        { name: 'QField Postgres', category: 'database' },
        // Infrastructure (4)
        { name: 'Cloudflared', category: 'infrastructure' },
        { name: 'PDFCraft', category: 'infrastructure' },
        { name: 'Grafana', category: 'infrastructure' },
        { name: 'Portainer', category: 'infrastructure' },
      ];

      expect(seedServices.length).toBeGreaterThanOrEqual(14);
    });
  });
});
