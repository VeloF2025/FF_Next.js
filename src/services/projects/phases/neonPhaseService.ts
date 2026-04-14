/**
 * Neon-based Phase Service
 * Handles all phase, step, and task operations using Neon PostgreSQL
 */

import { neon } from '@/lib/db-neon';

interface PhaseTaskRow {
  id: string;
  phaseId: string;
  name: string;
  description?: string;
  status: string;
  taskOrder?: number;
  assignedTo?: string;
  priority?: string;
  dueDate?: string;
  completedAt?: string;
  attachments?: unknown[];
  tags?: string[];
  dependencies?: string[];
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}
import { 
  Phase, 
  Step, 
  Task,
  PhaseStatus,
  StepStatus,
  TaskStatus,
  ChecklistItem,
  TaskComment,
  PhaseType,
  Priority
} from '@/types/project/hierarchy.types';
import { log } from '@/lib/logger';
import { sanitizeText } from '@/lib/security/sanitization';

// Get database connection
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const sql = neon(DATABASE_URL);

/**
 * Phase Operations
 */
export const phaseOperations = {
  /**
   * Get all phases for a project
   */
  async getProjectPhases(projectId: string): Promise<Phase[]> {
    try {
      const result = await sql`
        SELECT 
          id,
          project_id as "projectId",
          name,
          description,
          phase_type as "type",
          phase_order as "order",
          status,
          progress,
          planned_start_date as "plannedStartDate",
          planned_end_date as "plannedEndDate",
          actual_start_date as "actualStartDate",
          actual_end_date as "actualEndDate",
          dependencies,
          milestones,
          assigned_to as "assignedTo",
          budget,
          actual_cost as "actualCost",
          notes,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM project_phases
        WHERE project_id = ${projectId}::uuid
        ORDER BY phase_order ASC
      `;
      
      return result.map(row => ({
        ...row,
        dependencies: row.dependencies || [],
        milestones: row.milestones || [],
        assignedTo: row.assignedTo || []
      })) as Phase[];
    } catch (error) {
      log.error('Error getting project phases:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to fetch project phases');
    }
  },

  /**
   * Get a specific phase by ID
   */
  async getPhaseById(projectId: string, phaseId: string): Promise<Phase | null> {
    try {
      const result = await sql`
        SELECT 
          id,
          project_id as "projectId",
          name,
          description,
          phase_type as "type",
          phase_order as "order",
          status,
          progress,
          planned_start_date as "plannedStartDate",
          planned_end_date as "plannedEndDate",
          actual_start_date as "actualStartDate",
          actual_end_date as "actualEndDate",
          dependencies,
          milestones,
          assigned_to as "assignedTo",
          budget,
          actual_cost as "actualCost",
          notes,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM project_phases
        WHERE id = ${phaseId}::uuid AND project_id = ${projectId}::uuid
      `;
      
      if (result.length === 0) return null;
      
      const row = result[0]!;
      return {
        ...row,
        dependencies: row.dependencies || [],
        milestones: row.milestones || [],
        assignedTo: row.assignedTo || []
      } as Phase;
    } catch (error) {
      log.error('Error getting phase:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to fetch phase');
    }
  },

  /**
   * Create a new phase
   */
  async createPhase(projectId: string, phaseData: Partial<Phase>, userId: string): Promise<string> {
    try {
      const result = await sql`
        INSERT INTO project_phases (
          project_id,
          name,
          description,
          phase_type,
          phase_order,
          status,
          progress,
          planned_start_date,
          planned_end_date,
          dependencies,
          milestones,
          assigned_to,
          budget,
          notes,
          created_by
        ) VALUES (
          ${projectId}::uuid,
          ${phaseData.name},
          ${phaseData.description || null},
          ${phaseData.type || null},
          ${phaseData.order || 0},
          ${phaseData.status || PhaseStatus.NOT_STARTED},
          ${phaseData.progress || 0},
          ${phaseData.plannedStartDate || null},
          ${phaseData.plannedEndDate || null},
          ${JSON.stringify(phaseData.dependencies || [])}::jsonb,
          ${JSON.stringify(phaseData.milestones || [])}::jsonb,
          ${JSON.stringify(phaseData.assignedTo || [])}::jsonb,
          ${phaseData.budget || null},
          ${phaseData.notes || null},
          ${userId}
        )
        RETURNING id
      `;
      
      return result[0]!.id;
    } catch (error) {
      log.error('Error creating phase:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to create phase');
    }
  },

  /**
   * Update a phase
   */
  async updatePhase(projectId: string, phaseId: string, data: Partial<Phase>, userId: string): Promise<void> {
    try {
      await sql`
        UPDATE project_phases
        SET
          name = COALESCE(${data.name}, name),
          description = COALESCE(${data.description}, description),
          phase_type = COALESCE(${data.type}, phase_type),
          phase_order = COALESCE(${data.order}, phase_order),
          status = COALESCE(${data.status}, status),
          progress = COALESCE(${data.progress}, progress),
          planned_start_date = COALESCE(${data.plannedStartDate}, planned_start_date),
          planned_end_date = COALESCE(${data.plannedEndDate}, planned_end_date),
          actual_start_date = COALESCE(${data.actualStartDate}, actual_start_date),
          actual_end_date = COALESCE(${data.actualEndDate}, actual_end_date),
          dependencies = COALESCE(${data.dependencies ? JSON.stringify(data.dependencies) : null}::jsonb, dependencies),
          milestones = COALESCE(${data.milestones ? JSON.stringify(data.milestones) : null}::jsonb, milestones),
          assigned_to = COALESCE(${data.assignedTo ? JSON.stringify(data.assignedTo) : null}::jsonb, assigned_to),
          budget = COALESCE(${data.budget}, budget),
          actual_cost = COALESCE(${data.actualCost}, actual_cost),
          notes = COALESCE(${data.notes}, notes),
          updated_by = ${userId},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${phaseId}::uuid AND project_id = ${projectId}::uuid
      `;
    } catch (error) {
      log.error('Error updating phase:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to update phase');
    }
  },

  /**
   * Delete a phase
   */
  async deletePhase(projectId: string, phaseId: string): Promise<void> {
    try {
      await sql`
        DELETE FROM project_phases
        WHERE id = ${phaseId}::uuid AND project_id = ${projectId}::uuid
      `;
    } catch (error) {
      log.error('Error deleting phase:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to delete phase');
    }
  }
};

/**
 * Step Operations
 */
export const stepOperations = {
  /**
   * Get all steps for a phase
   */
  async getPhaseSteps(phaseId: string): Promise<Step[]> {
    try {
      const result = await sql`
        SELECT 
          id,
          phase_id as "phaseId",
          name,
          description,
          step_order as "order",
          status,
          progress,
          planned_duration as "plannedDuration",
          actual_duration as "actualDuration",
          start_date as "startDate",
          end_date as "endDate",
          assigned_to as "assignedTo",
          dependencies,
          resources,
          notes,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM phase_steps
        WHERE phase_id = ${phaseId}::uuid
        ORDER BY step_order ASC
      `;
      
      // Get checklist items for each step
      const stepsWithChecklist = await Promise.all(
        result.map(async (step) => {
          const checklist = await sql`
            SELECT id, text, completed, completed_by as "completedBy", completed_at as "completedAt"
            FROM phase_step_checklist
            WHERE step_id = ${step.id}::uuid
            ORDER BY created_at ASC
          `;
          
          return {
            ...step,
            assignedTo: step.assignedTo || [],
            dependencies: step.dependencies || [],
            resources: step.resources || [],
            checklist: checklist as ChecklistItem[]
          };
        })
      );
      
      return stepsWithChecklist as Step[];
    } catch (error) {
      log.error('Error getting phase steps:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to fetch phase steps');
    }
  },

  /**
   * Create a new step
   */
  async createStep(phaseId: string, stepData: Partial<Step>, userId: string): Promise<string> {
    try {
      const result = await sql`
        INSERT INTO phase_steps (
          phase_id,
          name,
          description,
          step_order,
          status,
          progress,
          planned_duration,
          assigned_to,
          dependencies,
          resources,
          notes,
          created_by
        ) VALUES (
          ${phaseId}::uuid,
          ${stepData.name},
          ${stepData.description || null},
          ${stepData.order || 0},
          ${stepData.status || StepStatus.NOT_STARTED},
          ${stepData.progress || 0},
          ${stepData.plannedDuration || null},
          ${JSON.stringify(stepData.assignedTo || [])}::jsonb,
          ${JSON.stringify(stepData.dependencies || [])}::jsonb,
          ${JSON.stringify(stepData.resources || [])}::jsonb,
          ${stepData.notes || null},
          ${userId}
        )
        RETURNING id
      `;
      
      return result[0]!.id;
    } catch (error) {
      log.error('Error creating step:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to create step');
    }
  },

  /**
   * Update a step
   */
  async updateStep(stepId: string, data: Partial<Step>, userId: string): Promise<void> {
    try {
      await sql`
        UPDATE phase_steps
        SET
          name = COALESCE(${data.name}, name),
          description = COALESCE(${data.description}, description),
          step_order = COALESCE(${data.order}, step_order),
          status = COALESCE(${data.status}, status),
          progress = COALESCE(${data.progress}, progress),
          planned_duration = COALESCE(${data.plannedDuration}, planned_duration),
          actual_duration = COALESCE(${data.actualDuration}, actual_duration),
          start_date = COALESCE(${data.startDate}, start_date),
          end_date = COALESCE(${data.endDate}, end_date),
          assigned_to = COALESCE(${data.assignedTo ? JSON.stringify(data.assignedTo) : null}::jsonb, assigned_to),
          dependencies = COALESCE(${data.dependencies ? JSON.stringify(data.dependencies) : null}::jsonb, dependencies),
          resources = COALESCE(${data.resources ? JSON.stringify(data.resources) : null}::jsonb, resources),
          notes = COALESCE(${data.notes}, notes),
          updated_by = ${userId},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${stepId}::uuid
      `;
    } catch (error) {
      log.error('Error updating step:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to update step');
    }
  }
};

/**
 * Task Operations
 */
export const taskOperations = {
  /**
   * Get all tasks for a step
   */
  async getStepTasks(stepId: string): Promise<Task[]> {
    try {
      const result = await sql`
        SELECT 
          id,
          step_id as "stepId",
          name,
          description,
          task_order as "order",
          status,
          priority,
          progress,
          estimated_hours as "estimatedHours",
          actual_hours as "actualHours",
          start_date as "startDate",
          due_date as "dueDate",
          completed_date as "completedDate",
          assigned_to as "assignedTo",
          assigned_to_name as "assignedToName",
          attachments,
          tags,
          is_blocked as "isBlocked",
          block_reason as "blockReason",
          dependencies,
          created_by as "createdBy",
          created_at as "createdAt",
          updated_by as "updatedBy",
          updated_at as "updatedAt"
        FROM phase_tasks
        WHERE step_id = ${stepId}::uuid
        ORDER BY task_order ASC
      `;
      
      // Get checklist and comments for each task
      const tasksWithDetails = await Promise.all(
        result.map(async (task) => {
          const [checklist, comments] = await Promise.all([
            sql`
              SELECT id, text, completed, completed_by as "completedBy", completed_at as "completedAt"
              FROM phase_task_checklist
              WHERE task_id = ${task.id}::uuid
              ORDER BY created_at ASC
            `,
            sql`
              SELECT id, text, author_id as "authorId", author_name as "authorName", created_at as "createdAt"
              FROM phase_task_comments
              WHERE task_id = ${task.id}::uuid
              ORDER BY created_at DESC
            `
          ]);
          
          return {
            ...task,
            attachments: task.attachments || [],
            tags: task.tags || [],
            dependencies: task.dependencies || [],
            checklist: checklist as ChecklistItem[],
            comments: comments as TaskComment[]
          };
        })
      );
      
      return tasksWithDetails as Task[];
    } catch (error) {
      log.error('Error getting step tasks:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to fetch step tasks');
    }
  },

  /**
   * Get tasks by phase
   */
  async getPhaseTasks(phaseId: string): Promise<Task[]> {
    try {
      const result = await sql`
        SELECT 
          t.id,
          t.step_id as "stepId",
          t.name,
          t.description,
          t.task_order as "order",
          t.status,
          t.priority,
          t.progress,
          t.estimated_hours as "estimatedHours",
          t.actual_hours as "actualHours",
          t.start_date as "startDate",
          t.due_date as "dueDate",
          t.completed_date as "completedDate",
          t.assigned_to as "assignedTo",
          t.assigned_to_name as "assignedToName",
          t.attachments,
          t.tags,
          t.is_blocked as "isBlocked",
          t.block_reason as "blockReason",
          t.dependencies,
          t.created_by as "createdBy",
          t.created_at as "createdAt",
          t.updated_by as "updatedBy",
          t.updated_at as "updatedAt"
        FROM phase_tasks t
        WHERE t.phase_id = ${phaseId}::uuid
        ORDER BY t.task_order ASC
      `;
      
      return (result as PhaseTaskRow[]).map((task) => ({
        ...task,
        attachments: task.attachments || [],
        tags: task.tags || [],
        dependencies: task.dependencies || [],
        checklist: [],
        comments: []
      })) as unknown as Task[];
    } catch (error) {
      log.error('Error getting phase tasks:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to fetch phase tasks');
    }
  },

  /**
   * Create a new task
   */
  async createTask(stepId: string, phaseId: string, projectId: string, taskData: Partial<Task>, userId: string): Promise<string> {
    try {
      const result = await sql`
        INSERT INTO phase_tasks (
          step_id,
          phase_id,
          project_id,
          name,
          description,
          task_order,
          status,
          priority,
          progress,
          estimated_hours,
          start_date,
          due_date,
          assigned_to,
          assigned_to_name,
          tags,
          dependencies,
          created_by
        ) VALUES (
          ${stepId}::uuid,
          ${phaseId}::uuid,
          ${projectId}::uuid,
          ${taskData.name},
          ${taskData.description || null},
          ${taskData.order || 0},
          ${taskData.status || TaskStatus.NOT_STARTED},
          ${taskData.priority || Priority.MEDIUM},
          ${taskData.progress || 0},
          ${taskData.estimatedHours || null},
          ${taskData.startDate || null},
          ${taskData.dueDate || null},
          ${taskData.assignedTo || null},
          ${taskData.assignedToName || null},
          ${JSON.stringify(taskData.tags || [])}::jsonb,
          ${JSON.stringify(taskData.dependencies || [])}::jsonb,
          ${userId}
        )
        RETURNING id
      `;
      
      return result[0]!.id;
    } catch (error) {
      log.error('Error creating task:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to create task');
    }
  },

  /**
   * Update a task
   */
  async updateTask(taskId: string, data: Partial<Task>, userId: string): Promise<void> {
    try {
      await sql`
        UPDATE phase_tasks
        SET
          name = COALESCE(${data.name}, name),
          description = COALESCE(${data.description}, description),
          task_order = COALESCE(${data.order}, task_order),
          status = COALESCE(${data.status}, status),
          priority = COALESCE(${data.priority}, priority),
          progress = COALESCE(${data.progress}, progress),
          estimated_hours = COALESCE(${data.estimatedHours}, estimated_hours),
          actual_hours = COALESCE(${data.actualHours}, actual_hours),
          start_date = COALESCE(${data.startDate}, start_date),
          due_date = COALESCE(${data.dueDate}, due_date),
          completed_date = COALESCE(${data.completedDate}, completed_date),
          assigned_to = COALESCE(${data.assignedTo}, assigned_to),
          assigned_to_name = COALESCE(${data.assignedToName}, assigned_to_name),
          attachments = COALESCE(${data.attachments ? JSON.stringify(data.attachments) : null}::jsonb, attachments),
          tags = COALESCE(${data.tags ? JSON.stringify(data.tags) : null}::jsonb, tags),
          is_blocked = COALESCE(${data.isBlocked}, is_blocked),
          block_reason = COALESCE(${data.blockReason}, block_reason),
          dependencies = COALESCE(${data.dependencies ? JSON.stringify(data.dependencies) : null}::jsonb, dependencies),
          updated_by = ${userId},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${taskId}::uuid
      `;
    } catch (error) {
      log.error('Error updating task:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to update task');
    }
  },

  /**
   * Add comment to task
   */
  async addTaskComment(taskId: string, text: string, authorId: string, authorName: string): Promise<void> {
    try {
      await sql`
        INSERT INTO phase_task_comments (task_id, text, author_id, author_name)
        VALUES (${taskId}::uuid, ${sanitizeText(text)}, ${authorId}, ${sanitizeText(authorName)})
      `;
    } catch (error) {
      log.error('Error adding task comment:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to add task comment');
    }
  },

  /**
   * Update task checklist item
   */
  async updateTaskChecklist(taskId: string, checklistId: string, completed: boolean, userId: string): Promise<void> {
    try {
      // Explicit branches to avoid conditional SQL fragments (Neon rule)
      if (completed) {
        await sql`
          UPDATE phase_task_checklist
          SET completed = ${completed}, completed_by = ${userId}, completed_at = CURRENT_TIMESTAMP
          WHERE id = ${checklistId}::uuid AND task_id = ${taskId}::uuid
        `;
      } else {
        await sql`
          UPDATE phase_task_checklist
          SET completed = ${completed}, completed_by = NULL, completed_at = NULL
          WHERE id = ${checklistId}::uuid AND task_id = ${taskId}::uuid
        `;
      }
    } catch (error) {
      log.error('Error updating task checklist:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to update task checklist');
    }
  }
};

/**
 * Progress Calculations
 */
export const progressCalculations = {
  /**
   * Calculate and update phase progress based on its steps
   */
  async updatePhaseProgress(phaseId: string): Promise<void> {
    try {
      await sql`
        UPDATE project_phases
        SET progress = (
          SELECT COALESCE(AVG(progress), 0)
          FROM phase_steps
          WHERE phase_id = ${phaseId}::uuid
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE id = ${phaseId}::uuid
      `;
    } catch (error) {
      log.error('Error updating phase progress:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to update phase progress');
    }
  },

  /**
   * Calculate and update step progress based on its tasks
   */
  async updateStepProgress(stepId: string): Promise<void> {
    try {
      await sql`
        UPDATE phase_steps
        SET progress = (
          SELECT COALESCE(AVG(progress), 0)
          FROM phase_tasks
          WHERE step_id = ${stepId}::uuid
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE id = ${stepId}::uuid
      `;
    } catch (error) {
      log.error('Error updating step progress:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to update step progress');
    }
  },

  /**
   * Calculate and update project progress based on all phases
   */
  async updateProjectProgress(projectId: string): Promise<void> {
    try {
      await sql`
        UPDATE projects
        SET progress = (
          SELECT COALESCE(AVG(progress), 0)
          FROM project_phases
          WHERE project_id = ${projectId}::uuid
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE id = ${projectId}::uuid
      `;
    } catch (error) {
      log.error('Error updating project progress:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to update project progress');
    }
  },

  /**
   * Get project progress summary
   */
  async getProjectProgressSummary(projectId: string) {
    try {
      const result = await sql`
        SELECT 
          COUNT(*) as total_phases,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_phases,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_phases,
          COUNT(CASE WHEN status = 'not_started' THEN 1 END) as not_started_phases,
          COALESCE(AVG(progress), 0) as overall_progress
        FROM project_phases
        WHERE project_id = ${projectId}::uuid
      `;
      
      const taskStats = await sql`
        SELECT 
          COUNT(*) as total_tasks,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tasks,
          COUNT(CASE WHEN status = 'blocked' THEN 1 END) as blocked_tasks
        FROM phase_tasks
        WHERE project_id = ${projectId}::uuid
      `;
      
      return {
        phases: result[0],
        tasks: taskStats[0]
      };
    } catch (error) {
      log.error('Error getting project progress summary:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to get project progress summary');
    }
  }
};

/**
 * Phase Generator - Generate default phases for a project
 */
export const phaseGenerator = {
  /**
   * Generate default phases for a project
   */
  async generateDefaultPhases(projectId: string, userId: string): Promise<void> {
    try {
      const defaultPhases = [
        { name: 'Planning', type: PhaseType.PLANNING, order: 1 },
        { name: 'Design', type: PhaseType.DESIGN, order: 2 },
        { name: 'Procurement', type: PhaseType.PROCUREMENT, order: 3 },
        { name: 'Construction', type: PhaseType.CONSTRUCTION, order: 4 },
        { name: 'Testing', type: PhaseType.TESTING, order: 5 },
        { name: 'Commissioning', type: PhaseType.COMMISSIONING, order: 6 },
        { name: 'Handover', type: PhaseType.HANDOVER, order: 7 }
      ];
      
      for (const phase of defaultPhases) {
        await phaseOperations.createPhase(projectId, {
          ...phase,
          status: PhaseStatus.NOT_STARTED,
          progress: 0
        }, userId);
      }
    } catch (error) {
      log.error('Error generating default phases:', { data: error }, 'neonPhaseService');
      throw new Error('Failed to generate default phases');
    }
  }
};

// Export all operations
export default {
  phaseOperations,
  stepOperations,
  taskOperations,
  progressCalculations,
  phaseGenerator
};