/**
 * Verification Service Tests
 * 🟢 WORKING: TDD tests for 12-step verification workflow
 *
 * Tests written FIRST following TDD methodology.
 * Uses mocked dependencies for unit testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as verificationService from '../../services/verificationService';
import * as db from '../../utils/db';
import { VerificationStep, VerificationStepNumber } from '../../types/verification';
import { VERIFICATION_STEP_TEMPLATES } from '../../constants/verificationSteps';

// Mock dependencies
vi.mock('../../utils/db');
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('VerificationService - TDD', () => {
  const mockTicketId = '123e4567-e89b-12d3-a456-426614174000';
  const mockUserId = '987fcdeb-51a2-43d7-b123-456789abcdef';
  const mockStepId = '111e2222-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to create mock verification step
  function createMockStep(stepNumber: VerificationStepNumber, overrides = {}): VerificationStep {
    const template = VERIFICATION_STEP_TEMPLATES[stepNumber];
    return {
      id: `${mockStepId}-${stepNumber}`,
      ticket_id: mockTicketId,
      step_number: stepNumber,
      step_name: template.step_name,
      step_description: template.step_description,
      is_complete: false,
      completed_at: null,
      completed_by: null,
      photo_required: template.photo_required,
      photo_url: null,
      photo_verified: false,
      notes: null,
      created_at: new Date(),
      ...overrides,
    };
  }

  describe('initializeVerificationSteps', () => {
    // PR4: the default install template was consolidated from 12 steps to 6
    // with named photo_slots. These tests assert the new contract for
    // activations/new_installation. Other ticket types (fault_repair, etc.)
    // still have their own non-slot step counts.
    const INSTALL_STEP_COUNT = 6;

    it(`should initialize exactly ${INSTALL_STEP_COUNT} verification steps for the default install template`, async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce({ id: mockTicketId }); // ticket exists
      vi.mocked(db.query).mockResolvedValueOnce([]); // no existing steps

      const mockSteps = Array.from({ length: INSTALL_STEP_COUNT }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber)
      );

      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        const mockTxn = {
          // Pre-seed INSERT returns a row per slot via RETURNING id.
          query: vi.fn().mockResolvedValue([{ id: 'mock-slot' }]),
          queryOne: vi.fn().mockImplementation(async () => {
            return mockSteps.shift();
          }),
        };
        return await callback(mockTxn as Parameters<typeof callback>[0]);
      });

      // Act
      const steps = await verificationService.initializeVerificationSteps(mockTicketId);

      // Assert
      expect(steps).toHaveLength(INSTALL_STEP_COUNT);
    });

    it(`should create steps with correct step numbers 1-${INSTALL_STEP_COUNT}`, async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce({ id: mockTicketId });
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const mockSteps = Array.from({ length: INSTALL_STEP_COUNT }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber)
      );

      vi.mocked(db.transaction).mockResolvedValue(mockSteps);

      // Act
      const steps = await verificationService.initializeVerificationSteps(mockTicketId);

      // Assert
      const stepNumbers = steps.map(s => s.step_number).sort((a, b) => a - b);
      expect(stepNumbers).toEqual(Array.from({ length: INSTALL_STEP_COUNT }, (_, i) => i + 1));
    });

    it('should initialize all steps as incomplete', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce({ id: mockTicketId });
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const mockSteps = Array.from({ length: INSTALL_STEP_COUNT }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber)
      );

      vi.mocked(db.transaction).mockResolvedValue(mockSteps);

      // Act
      const steps = await verificationService.initializeVerificationSteps(mockTicketId);

      // Assert
      steps.forEach(step => {
        expect(step.is_complete).toBe(false);
        expect(step.completed_at).toBeNull();
        expect(step.completed_by).toBeNull();
      });
    });

    it('should set photo_required = true on every install step (slot-aware)', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce({ id: mockTicketId });
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const mockSteps = Array.from({ length: INSTALL_STEP_COUNT }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber)
      );

      vi.mocked(db.transaction).mockResolvedValue(mockSteps);

      // Act
      const steps = await verificationService.initializeVerificationSteps(mockTicketId);

      // Assert — the 6-step install template marks every step photo_required.
      // Slot-level required flags are tested separately at the template level.
      steps.forEach(step => {
        expect(step.photo_required).toBe(true);
      });
    });

    it('should pre-seed maintenance_step_photos rows for every photo_slot in the install template', async () => {
      // Mirrors the production INSTALL_STEPS_WITH_SLOTS — 6 steps with 11
      // total slots. The test asserts the pre-seed loop calls txn.query for
      // every slot with the slot metadata coming straight from the template
      // (label, source_mode, is_required — never client-supplied).
      vi.mocked(db.queryOne).mockResolvedValueOnce({ id: mockTicketId });
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const slotQueries: Array<{ sql: string; params: unknown[] }> = [];
      const stepIds = ['step-1', 'step-2', 'step-3', 'step-4', 'step-5', 'step-6'];

      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        let stepIndex = 0;
        const mockTxn = {
          query: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
            // Only capture the INSERT INTO maintenance_step_photos calls;
            // RETURNING id => one inserted row.
            if (sql.includes('maintenance_step_photos')) {
              slotQueries.push({ sql, params });
              return [{ id: `slot-${slotQueries.length}` }];
            }
            return [];
          }),
          queryOne: vi.fn().mockImplementation(async () => {
            const id = stepIds[stepIndex++];
            return id ? createMockStep(((stepIndex) % 12 + 1) as VerificationStepNumber, { id }) : null;
          }),
        };
        return await callback(mockTxn as Parameters<typeof callback>[0]);
      });

      await verificationService.initializeVerificationSteps(mockTicketId, 'activations');

      // 11 photo slots across 6 steps (1 + 1 + 3 + 2 + 2 + 2) in the install template.
      expect(slotQueries).toHaveLength(11);

      // Spot-check the 1Map sign-up slot — source_mode must be 'gallery' so
      // the resolve page hides the camera-capture attribute.
      const onemapSlot = slotQueries.find((q) => q.params[1] === 'onemap_signup_screenshot');
      expect(onemapSlot).toBeDefined();
      expect(onemapSlot?.params[3]).toBe('gallery');
      expect(onemapSlot?.params[4]).toBe(true); // is_required

      // Spot-check a camera slot.
      const ontCloseup = slotQueries.find((q) => q.params[1] === 'ont_closeup');
      expect(ontCloseup).toBeDefined();
      expect(ontCloseup?.params[3]).toBe('camera');

      // Every INSERT must use ON CONFLICT DO NOTHING for idempotency.
      slotQueries.forEach((q) => {
        expect(q.sql).toContain('ON CONFLICT (step_id, slot_key) DO NOTHING');
      });
    });

    it('should not pre-seed maintenance_step_photos for templates without slots (legacy fault_repair)', async () => {
      vi.mocked(db.queryOne).mockResolvedValueOnce({ id: mockTicketId });
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const txnQuery = vi.fn().mockResolvedValue([]);
      let returned = 0;
      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        const mockTxn = {
          query: txnQuery,
          queryOne: vi.fn().mockImplementation(async () => {
            returned += 1;
            return createMockStep(((returned - 1) % 12 + 1) as VerificationStepNumber);
          }),
        };
        return await callback(mockTxn as Parameters<typeof callback>[0]);
      });

      await verificationService.initializeVerificationSteps(mockTicketId, 'fault_repair');

      // fault_repair template has no photo_slots → zero INSERTs into
      // maintenance_step_photos.
      const slotInserts = txnQuery.mock.calls.filter((call: unknown[]) => {
        const sqlArg = call[0];
        return typeof sqlArg === 'string' && sqlArg.includes('maintenance_step_photos');
      });
      expect(slotInserts).toHaveLength(0);
    });

    it('should throw error if ticket does not exist', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce(null); // ticket not found

      // Act & Assert
      await expect(
        verificationService.initializeVerificationSteps(mockTicketId)
      ).rejects.toThrow('Ticket not found');
    });

    it('should throw error if steps already initialized for ticket', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce({ id: mockTicketId });
      vi.mocked(db.query).mockResolvedValueOnce([{ id: mockStepId }]); // existing steps

      // Act & Assert
      await expect(
        verificationService.initializeVerificationSteps(mockTicketId)
      ).rejects.toThrow('Verification steps already initialized');
    });

    it('should throw error if ticket ID is invalid format', async () => {
      // Arrange
      const invalidId = 'not-a-uuid';

      // Act & Assert
      await expect(
        verificationService.initializeVerificationSteps(invalidId)
      ).rejects.toThrow('Invalid ticket ID format');
    });
  });

  describe('getVerificationSteps', () => {
    it('should retrieve all 12 steps for a ticket', async () => {
      // Arrange
      const mockSteps = Array.from({ length: 12 }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber)
      );

      vi.mocked(db.query).mockResolvedValueOnce(mockSteps);

      // Act
      const steps = await verificationService.getVerificationSteps(mockTicketId);

      // Assert
      expect(steps).toHaveLength(12);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY s.step_number ASC'),
        [mockTicketId]
      );
    });

    it('should LEFT JOIN attachments and aggregate into photos[]', async () => {
      // Arrange
      vi.mocked(db.query).mockResolvedValueOnce([]);

      // Act
      await verificationService.getVerificationSteps(mockTicketId);

      // Assert — SQL includes the aggregated photo gallery + back-compat cover
      const callSql = vi.mocked(db.query).mock.calls[0]?.[0] as string;
      expect(callSql).toContain('LEFT JOIN maintenance_attachments');
      expect(callSql).toContain("a.verification_step_id = s.id");
      expect(callSql).toContain('a.is_evidence = true');
      expect(callSql).toContain('AS photos');
      expect(callSql).toContain('s.photo_url');
    });

    it('should return empty array if ticket has no verification steps', async () => {
      // Arrange
      vi.mocked(db.query).mockResolvedValueOnce([]);

      // Act
      const steps = await verificationService.getVerificationSteps(mockTicketId);

      // Assert
      expect(steps).toEqual([]);
    });

    it('should throw error if ticket ID is invalid format', async () => {
      // Arrange
      const invalidId = 'invalid';

      // Act & Assert
      await expect(
        verificationService.getVerificationSteps(invalidId)
      ).rejects.toThrow('Invalid ticket ID format');
    });
  });

  describe('getVerificationStep', () => {
    it('should retrieve a specific step by ticket ID and step number', async () => {
      // Arrange
      const mockStep = createMockStep(5);
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockStep);

      // Act
      const step = await verificationService.getVerificationStep(mockTicketId, 5);

      // Assert
      expect(step).not.toBeNull();
      expect(step?.step_number).toBe(5);
      expect(step?.step_name).toBe('ONT Installation');
    });

    it('should return null if step does not exist', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce(null);

      // Act
      const step = await verificationService.getVerificationStep(mockTicketId, 13 as VerificationStepNumber);

      // Assert
      expect(step).toBeNull();
    });

    it('should throw error if ticket ID is invalid format', async () => {
      // Arrange
      const invalidId = 'invalid-id';

      // Act & Assert
      await expect(
        verificationService.getVerificationStep(invalidId, 1)
      ).rejects.toThrow('Invalid ticket ID format');
    });
  });

  describe('updateVerificationStep - Mark Complete', () => {
    it('should mark step as complete with timestamp', async () => {
      // Arrange
      const existingStep = createMockStep(1);
      const updatedStep = createMockStep(1, {
        is_complete: true,
        completed_by: mockUserId,
        completed_at: new Date(),
      });

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(existingStep)  // getVerificationStep check
        .mockResolvedValueOnce(updatedStep);  // UPDATE result

      // Act
      const result = await verificationService.updateVerificationStep(mockTicketId, 1, {
        is_complete: true,
        completed_by: mockUserId,
      });

      // Assert
      expect(result.is_complete).toBe(true);
      expect(result.completed_by).toBe(mockUserId);
      expect(result.completed_at).toBeInstanceOf(Date);
    });

    it('should allow marking completed step as incomplete', async () => {
      // Arrange
      const completedStep = createMockStep(1, {
        is_complete: true,
        completed_by: mockUserId,
        completed_at: new Date(),
      });

      const incompleteStep = createMockStep(1, {
        is_complete: false,
        completed_by: null,
        completed_at: null,
      });

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(completedStep)
        .mockResolvedValueOnce(incompleteStep);

      // Act
      const result = await verificationService.updateVerificationStep(mockTicketId, 1, {
        is_complete: false,
      });

      // Assert
      expect(result.is_complete).toBe(false);
    });

    it('should throw error if step does not exist', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        verificationService.updateVerificationStep(mockTicketId, 99 as VerificationStepNumber, {
          is_complete: true,
        })
      ).rejects.toThrow('Verification step not found');
    });
  });

  describe('updateVerificationStep - Add Photo URL', () => {
    it('should add photo URL to step', async () => {
      // Arrange
      const photoUrl = '/api/uploads/maintenance-attachments/test.jpg';
      const existingStep = createMockStep(1);
      const updatedStep = createMockStep(1, { photo_url: photoUrl });

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(existingStep)
        .mockResolvedValueOnce(updatedStep);

      // Act
      const result = await verificationService.updateVerificationStep(mockTicketId, 1, {
        photo_url: photoUrl,
      });

      // Assert
      expect(result.photo_url).toBe(photoUrl);
    });

    it('should mark photo as verified', async () => {
      // Arrange
      const existingStep = createMockStep(1);
      const updatedStep = createMockStep(1, { photo_verified: true });

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(existingStep)
        .mockResolvedValueOnce(updatedStep);

      // Act
      const result = await verificationService.updateVerificationStep(mockTicketId, 1, {
        photo_verified: true,
      });

      // Assert
      expect(result.photo_verified).toBe(true);
    });
  });

  describe('updateVerificationStep - Add Notes', () => {
    it('should add notes to step', async () => {
      // Arrange
      const notes = 'Site assessment completed. Access confirmed.';
      const existingStep = createMockStep(1);
      const updatedStep = createMockStep(1, { notes });

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(existingStep)
        .mockResolvedValueOnce(updatedStep);

      // Act
      const result = await verificationService.updateVerificationStep(mockTicketId, 1, { notes });

      // Assert
      expect(result.notes).toBe(notes);
    });

    it('should allow clearing notes by setting to null', async () => {
      // Arrange
      const existingStep = createMockStep(1, { notes: 'Some notes' });
      const updatedStep = createMockStep(1, { notes: null });

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(existingStep)
        .mockResolvedValueOnce(updatedStep);

      // Act
      const result = await verificationService.updateVerificationStep(mockTicketId, 1, {
        notes: null,
      });

      // Assert
      expect(result.notes).toBeNull();
    });
  });

  describe('updateVerificationStep - Multiple Fields', () => {
    it('should update multiple fields at once', async () => {
      // Arrange
      const photoUrl = '/api/uploads/maintenance-attachments/complete.jpg';
      const notes = 'All requirements met';
      const existingStep = createMockStep(1);
      const updatedStep = createMockStep(1, {
        is_complete: true,
        completed_by: mockUserId,
        completed_at: new Date(),
        photo_url: photoUrl,
        photo_verified: true,
        notes,
      });

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(existingStep)
        .mockResolvedValueOnce(updatedStep);

      // Act
      const result = await verificationService.updateVerificationStep(mockTicketId, 1, {
        is_complete: true,
        completed_by: mockUserId,
        photo_url: photoUrl,
        photo_verified: true,
        notes,
      });

      // Assert
      expect(result.is_complete).toBe(true);
      expect(result.completed_by).toBe(mockUserId);
      expect(result.completed_at).toBeInstanceOf(Date);
      expect(result.photo_url).toBe(photoUrl);
      expect(result.photo_verified).toBe(true);
      expect(result.notes).toBe(notes);
    });

    it('should preserve existing data when partially updating step', async () => {
      // Arrange
      const photoUrl = '/api/uploads/maintenance-attachments/original.jpg';
      const existingStep = createMockStep(1, {
        is_complete: true,
        completed_by: mockUserId,
        completed_at: new Date(),
        photo_url: photoUrl,
        notes: 'Original notes',
      });

      const updatedStep = createMockStep(1, {
        is_complete: true,
        completed_by: mockUserId,
        completed_at: existingStep.completed_at,
        photo_url: photoUrl,
        notes: 'Updated notes only',
      });

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(existingStep)
        .mockResolvedValueOnce(updatedStep);

      // Act
      const result = await verificationService.updateVerificationStep(mockTicketId, 1, {
        notes: 'Updated notes only',
      });

      // Assert
      expect(result.notes).toBe('Updated notes only');
      expect(result.is_complete).toBe(true);
      expect(result.photo_url).toBe(photoUrl);
    });

    it('should return existing step if no fields to update', async () => {
      // Arrange
      const existingStep = createMockStep(1);
      vi.mocked(db.queryOne).mockResolvedValueOnce(existingStep);

      // Act
      const result = await verificationService.updateVerificationStep(mockTicketId, 1, {});

      // Assert
      expect(result).toEqual(existingStep);
    });
  });

  describe('calculateProgress', () => {
    it('should calculate 0% progress when no steps complete', async () => {
      // Arrange
      const mockSteps = Array.from({ length: 12 }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber)
      );

      vi.mocked(db.query).mockResolvedValueOnce(mockSteps);

      // Act
      const progress = await verificationService.calculateProgress(mockTicketId);

      // Assert
      expect(progress.completed_steps).toBe(0);
      expect(progress.total_steps).toBe(12);
      expect(progress.pending_steps).toBe(12);
      expect(progress.progress_percentage).toBe(0);
      expect(progress.all_steps_complete).toBe(false);
    });

    it('should calculate progress after completing some steps (3/12 = 25%)', async () => {
      // Arrange
      const mockSteps = Array.from({ length: 12 }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber, {
          is_complete: i < 3, // First 3 steps complete
          completed_by: i < 3 ? mockUserId : null,
          completed_at: i < 3 ? new Date() : null,
        })
      );

      vi.mocked(db.query).mockResolvedValueOnce(mockSteps);

      // Act
      const progress = await verificationService.calculateProgress(mockTicketId);

      // Assert
      expect(progress.completed_steps).toBe(3);
      expect(progress.pending_steps).toBe(9);
      expect(progress.progress_percentage).toBe(25);
      expect(progress.all_steps_complete).toBe(false);
    });

    it('should calculate 100% progress when all steps complete', async () => {
      // Arrange
      const mockSteps = Array.from({ length: 12 }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber, {
          is_complete: true,
          completed_by: mockUserId,
          completed_at: new Date(),
        })
      );

      vi.mocked(db.query).mockResolvedValueOnce(mockSteps);

      // Act
      const progress = await verificationService.calculateProgress(mockTicketId);

      // Assert
      expect(progress.completed_steps).toBe(12);
      expect(progress.pending_steps).toBe(0);
      expect(progress.progress_percentage).toBe(100);
      expect(progress.all_steps_complete).toBe(true);
    });

    it('should format progress correctly (7/12 format)', async () => {
      // Arrange
      const mockSteps = Array.from({ length: 12 }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber, {
          is_complete: i < 7, // First 7 steps complete
          completed_by: i < 7 ? mockUserId : null,
          completed_at: i < 7 ? new Date() : null,
        })
      );

      vi.mocked(db.query).mockResolvedValueOnce(mockSteps);

      // Act
      const progress = await verificationService.calculateProgress(mockTicketId);

      // Assert
      expect(progress.completed_steps).toBe(7);
      expect(progress.total_steps).toBe(12);
      const formattedProgress = `${progress.completed_steps}/${progress.total_steps}`;
      expect(formattedProgress).toBe('7/12');
    });

    it('should include all steps in progress response', async () => {
      // Arrange
      const mockSteps = Array.from({ length: 12 }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber)
      );

      vi.mocked(db.query).mockResolvedValueOnce(mockSteps);

      // Act
      const progress = await verificationService.calculateProgress(mockTicketId);

      // Assert
      expect(progress.steps).toHaveLength(12);
      expect(progress.steps[0].step_number).toBe(1);
      expect(progress.steps[11].step_number).toBe(12);
    });

    it('should throw error if ticket has no verification steps', async () => {
      // Arrange
      vi.mocked(db.query).mockResolvedValueOnce([]);

      // Act & Assert
      await expect(
        verificationService.calculateProgress(mockTicketId)
      ).rejects.toThrow('No verification steps found');
    });

    it('should throw error if ticket ID is invalid format', async () => {
      // Arrange
      const invalidId = 'not-a-uuid';

      // Act & Assert
      await expect(
        verificationService.calculateProgress(invalidId)
      ).rejects.toThrow('Invalid ticket ID format');
    });
  });

  describe('isAllStepsComplete', () => {
    it('should return false when no steps are complete', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce({
        completed: 0,
        total: 12,
      });

      // Act
      const allComplete = await verificationService.isAllStepsComplete(mockTicketId);

      // Assert
      expect(allComplete).toBe(false);
    });

    it('should return false when some steps are complete', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce({
        completed: 7,
        total: 12,
      });

      // Act
      const allComplete = await verificationService.isAllStepsComplete(mockTicketId);

      // Assert
      expect(allComplete).toBe(false);
    });

    it('should return true when all 12 steps are complete', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce({
        completed: 12,
        total: 12,
      });

      // Act
      const allComplete = await verificationService.isAllStepsComplete(mockTicketId);

      // Assert
      expect(allComplete).toBe(true);
    });

    it('should return false if even one step is incomplete', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce({
        completed: 11,
        total: 12,
      });

      // Act
      const allComplete = await verificationService.isAllStepsComplete(mockTicketId);

      // Assert
      expect(allComplete).toBe(false);
    });

    it('should return false if no steps exist', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce(null);

      // Act
      const allComplete = await verificationService.isAllStepsComplete(mockTicketId);

      // Assert
      expect(allComplete).toBe(false);
    });

    it('should throw error if ticket ID is invalid format', async () => {
      // Arrange
      const invalidId = 'invalid';

      // Act & Assert
      await expect(
        verificationService.isAllStepsComplete(invalidId)
      ).rejects.toThrow('Invalid ticket ID format');
    });
  });

  describe('deleteVerificationSteps', () => {
    it('should delete all verification steps for a ticket', async () => {
      // Arrange
      vi.mocked(db.query).mockResolvedValueOnce([]);

      // Act
      await verificationService.deleteVerificationSteps(mockTicketId);

      // Assert
      expect(db.query).toHaveBeenCalledWith(
        'DELETE FROM maintenance_verification_steps WHERE ticket_id = $1',
        [mockTicketId]
      );
    });

    it('should not throw error if no steps exist', async () => {
      // Arrange
      vi.mocked(db.query).mockResolvedValueOnce([]);

      // Act & Assert
      await expect(
        verificationService.deleteVerificationSteps(mockTicketId)
      ).resolves.not.toThrow();
    });

    it('should throw error if ticket ID is invalid format', async () => {
      // Arrange
      const invalidId = 'not-valid';

      // Act & Assert
      await expect(
        verificationService.deleteVerificationSteps(invalidId)
      ).rejects.toThrow('Invalid ticket ID format');
    });
  });

  describe('Photo Required Validation', () => {
    it('should identify steps that require photos', async () => {
      // Arrange
      const mockSteps = Array.from({ length: 12 }, (_, i) =>
        createMockStep((i + 1) as VerificationStepNumber)
      );

      vi.mocked(db.query).mockResolvedValueOnce(mockSteps);

      // Act
      const steps = await verificationService.getVerificationSteps(mockTicketId);

      // Assert
      const photoRequiredSteps = steps.filter(s => s.photo_required);
      expect(photoRequiredSteps.length).toBeGreaterThan(0);

      const step9 = steps.find(s => s.step_number === 9);
      expect(step9?.photo_required).toBe(false);
    });

    it('should track photo verification status separately from completion', async () => {
      // Arrange
      const photoUrl = '/api/uploads/maintenance-attachments/test.jpg';
      const existingStep = createMockStep(1, {
        photo_url: photoUrl,
        is_complete: true,
        completed_by: mockUserId,
        completed_at: new Date(),
        photo_verified: false,
      });

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(existingStep)
        .mockResolvedValueOnce(existingStep);

      // Act
      const step = await verificationService.getVerificationStep(mockTicketId, 1);

      // Assert
      expect(step?.photo_url).toBe(photoUrl);
      expect(step?.photo_verified).toBe(false);
      expect(step?.is_complete).toBe(true);
    });
  });
});
