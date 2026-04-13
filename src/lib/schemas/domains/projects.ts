/**
 * Project domain schemas
 * Defines validation schemas for all project-related API operations
 */

import { z } from 'zod';
import {
  IdSchema,
  AuditFieldsSchema,
  CoordinatesSchema,
  MoneySchema,
  PaginationParamsSchema,
} from '../common';

// ============================================================================
// Project Core Schemas
// ============================================================================

export const ProjectStatusSchema = z.enum([
  'draft',
  'planning',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
]);

export const ProjectTypeSchema = z.enum([
  'fibre',
  'infrastructure',
  'maintenance',
  'installation',
  'survey',
]);

export const ProjectPrioritySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  projectCode: z.string().min(1).max(50),
  clientId: IdSchema,
  type: ProjectTypeSchema,
  status: ProjectStatusSchema,
  priority: ProjectPrioritySchema,
  
  // Dates
  startDate: z.string().datetime().or(z.date()),
  endDate: z.string().datetime().or(z.date()),
  actualStartDate: z.string().datetime().or(z.date()).optional(),
  actualEndDate: z.string().datetime().or(z.date()).optional(),
  
  // Location
  location: z.object({
    address: z.string(),
    city: z.string(),
    province: z.string(),
    coordinates: CoordinatesSchema.optional(),
  }),
  
  // Budget
  budget: MoneySchema,
  actualCost: MoneySchema.optional(),
  
  // Progress
  progress: z.number().min(0).max(100).default(0),
  milestones: z.array(z.object({
    id: IdSchema,
    name: z.string(),
    description: z.string().optional(),
    dueDate: z.string().datetime().or(z.date()),
    completed: z.boolean().default(false),
    completedAt: z.string().datetime().or(z.date()).optional(),
  })).optional(),
  
  // Team
  projectManagerId: IdSchema.optional(),
  teamMemberIds: z.array(IdSchema).optional(),
  
  // Metadata
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.any()).optional(),
}).merge(AuditFieldsSchema);

// ============================================================================
// Project Creation/Update Schemas
// ============================================================================

export const CreateProjectSchema = ProjectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  progress: true,
  actualCost: true,
});

export const UpdateProjectSchema = CreateProjectSchema.partial();

// ============================================================================
// Project Query Schemas
// ============================================================================

export const ProjectQuerySchema = PaginationParamsSchema.extend({
  search: z.string().optional(),
  status: z.union([ProjectStatusSchema, z.array(ProjectStatusSchema)]).optional(),
  type: z.union([ProjectTypeSchema, z.array(ProjectTypeSchema)]).optional(),
  priority: z.union([ProjectPrioritySchema, z.array(ProjectPrioritySchema)]).optional(),
  clientId: IdSchema.optional(),
  projectManagerId: IdSchema.optional(),
  startDateFrom: z.string().datetime().optional(),
  startDateTo: z.string().datetime().optional(),
  endDateFrom: z.string().datetime().optional(),
  endDateTo: z.string().datetime().optional(),
  minProgress: z.coerce.number().min(0).max(100).optional(),
  maxProgress: z.coerce.number().min(0).max(100).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
});

export const ProjectParamsSchema = z.object({
  id: IdSchema,
});

// ============================================================================
// Project Statistics Schemas
// ============================================================================

export const ProjectStatsSchema = z.object({
  totalProjects: z.number(),
  activeProjects: z.number(),
  completedProjects: z.number(),
  onHoldProjects: z.number(),
  totalBudget: MoneySchema,
  totalActualCost: MoneySchema,
  averageProgress: z.number(),
  averageProjectDuration: z.number(), // in days
  projectsByStatus: z.record(ProjectStatusSchema, z.number()),
  projectsByType: z.record(ProjectTypeSchema, z.number()),
  projectsByPriority: z.record(ProjectPrioritySchema, z.number()),
  upcomingMilestones: z.array(z.object({
    projectId: IdSchema,
    projectName: z.string(),
    milestoneName: z.string(),
    dueDate: z.string().datetime(),
  })),
});

// ============================================================================
// Project Import/Export Schemas
// ============================================================================

export const ProjectImportSchema = z.object({
  projects: z.array(CreateProjectSchema),
  options: z.object({
    skipDuplicates: z.boolean().default(false),
    updateExisting: z.boolean().default(false),
    validateReferences: z.boolean().default(true),
  }).optional(),
});

export const ProjectExportQuerySchema = z.object({
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
  fields: z.array(z.string()).optional(),
  includeRelated: z.boolean().default(false),
}).merge(ProjectQuerySchema);

// ============================================================================
// Project Team Schemas
// ============================================================================

export const ProjectTeamMemberSchema = z.object({
  userId: IdSchema,
  role: z.enum(['manager', 'lead', 'member', 'observer']),
  allocation: z.number().min(0).max(100), // percentage
  startDate: z.string().datetime().or(z.date()),
  endDate: z.string().datetime().or(z.date()).optional(),
  responsibilities: z.array(z.string()).optional(),
});

export const UpdateProjectTeamSchema = z.object({
  projectId: IdSchema,
  teamMembers: z.array(ProjectTeamMemberSchema),
});

// ============================================================================
// Type Exports
// ============================================================================

export type Project = z.infer<typeof ProjectSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type ProjectQuery = z.infer<typeof ProjectQuerySchema>;
export type ProjectParams = z.infer<typeof ProjectParamsSchema>;
export type ProjectStats = z.infer<typeof ProjectStatsSchema>;
export type ProjectImport = z.infer<typeof ProjectImportSchema>;
export type ProjectExportQuery = z.infer<typeof ProjectExportQuerySchema>;
export type ProjectTeamMember = z.infer<typeof ProjectTeamMemberSchema>;
export type UpdateProjectTeam = z.infer<typeof UpdateProjectTeamSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type ProjectType = z.infer<typeof ProjectTypeSchema>;
export type ProjectPriority = z.infer<typeof ProjectPrioritySchema>;