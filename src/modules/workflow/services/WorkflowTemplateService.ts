/**
 * WorkflowTemplateService - Specialized service for workflow template operations
 * Handles template import/export, analytics, and advanced template management
 */

import { workflowManagementService } from './WorkflowManagementService';
import type {
  WorkflowTemplate,
  WorkflowTemplateExport,
  TemplateImportResult,
  WorkflowAnalytics,
  WorkflowTemplateQuery
} from '../types/workflow.types';

export class WorkflowTemplateService {
  /**
   * TEMPLATE ANALYTICS AND METRICS
   */

  async getTemplateAnalytics(dateFrom?: string, dateTo?: string): Promise<WorkflowAnalytics> {
    const sql = `
      WITH template_stats AS (
        SELECT 
          wt.id,
          wt.name as template_name,
          COUNT(pw.id) as project_count,
          AVG(
            CASE 
              WHEN pw.actual_end_date IS NOT NULL AND pw.start_date IS NOT NULL 
              THEN EXTRACT(EPOCH FROM (pw.actual_end_date::timestamp - pw.start_date::timestamp)) / 86400
              ELSE NULL
            END
          ) as avg_duration_days,
          (COUNT(CASE WHEN pw.status = 'completed' THEN 1 END)::float / NULLIF(COUNT(pw.id), 0)) * 100 as success_rate
        FROM workflow_templates wt
        LEFT JOIN project_workflows pw ON wt.id = pw.workflow_template_id
        WHERE 1=1
          ${dateFrom ? 'AND pw.created_at >= $1' : ''}
          ${dateTo ? `AND pw.created_at <= $${dateFrom ? '2' : '1'}` : ''}
        GROUP BY wt.id, wt.name
      ),
      phase_stats AS (
        SELECT 
          wp.name as phase_name,
          AVG(wp.estimated_duration) as avg_duration,
          COUNT(pwp.phase_id) as usage_count,
          (COUNT(CASE WHEN pwp.status = 'completed' THEN 1 END)::float / NULLIF(COUNT(pwp.phase_id), 0)) * 100 as completion_rate
        FROM workflow_phases wp
        LEFT JOIN project_workflow_phases pwp ON wp.id = pwp.phase_id
        WHERE wp.workflow_template_id IN (
          SELECT DISTINCT workflow_template_id 
          FROM project_workflows 
          WHERE 1=1
            ${dateFrom ? 'AND created_at >= $1' : ''}
            ${dateTo ? `AND created_at <= $${dateFrom ? '2' : '1'}` : ''}
        )
        GROUP BY wp.id, wp.name
      )
      SELECT 
        json_build_object(
          'templateUsage', json_agg(DISTINCT jsonb_build_object(
            'templateId', ts.id,
            'templateName', ts.template_name,
            'projectCount', ts.project_count,
            'averageDuration', COALESCE(ts.avg_duration_days, 0),
            'successRate', COALESCE(ts.success_rate, 0)
          )),
          'phaseMetrics', json_agg(DISTINCT jsonb_build_object(
            'phaseName', ps.phase_name,
            'averageDuration', COALESCE(ps.avg_duration, 0),
            'completionRate', COALESCE(ps.completion_rate, 0),
            'bottleneckRisk', CASE WHEN ps.completion_rate < 80 THEN 'high' ELSE 'low' END
          )),
          'performanceMetrics', json_build_object(
            'totalProjects', (SELECT COUNT(*) FROM project_workflows WHERE created_at >= COALESCE($1, '1900-01-01'::date) AND created_at <= COALESCE($2, NOW())),
            'averageProjectDuration', (SELECT AVG(EXTRACT(EPOCH FROM (actual_end_date::timestamp - start_date::timestamp)) / 86400) FROM project_workflows WHERE actual_end_date IS NOT NULL AND start_date IS NOT NULL),
            'onTimeCompletion', (SELECT (COUNT(CASE WHEN actual_end_date <= planned_end_date THEN 1 END)::float / NULLIF(COUNT(*), 0)) * 100 FROM project_workflows WHERE actual_end_date IS NOT NULL AND planned_end_date IS NOT NULL),
            'mostUsedTemplates', (SELECT json_agg(template_name ORDER BY project_count DESC) FROM template_stats WHERE project_count > 0 LIMIT 5),
            'commonBottlenecks', json_build_array('Resource allocation', 'Approval delays', 'Technical complexity')
          )
        ) as analytics
      FROM template_stats ts
      CROSS JOIN phase_stats ps
    `;

    const params = [dateFrom || '1900-01-01', dateTo || new Date().toISOString()];
    const result = await workflowManagementService['client'].query(sql, params);
    
    return result.rows[0]?.analytics || {
      templateUsage: [],
      phaseMetrics: [],
      performanceMetrics: {
        totalProjects: 0,
        averageProjectDuration: 0,
        onTimeCompletion: 0,
        mostUsedTemplates: [],
        commonBottlenecks: []
      }
    };
  }

  async getPopularTemplates(limit = 10): Promise<WorkflowTemplate[]> {
    const query: WorkflowTemplateQuery = {
      limit,
      orderBy: 'project_count',
      orderDirection: 'desc'
    };

    const result = await workflowManagementService.getTemplates(query);
    return result.templates;
  }

  async getRecentTemplates(limit = 10): Promise<WorkflowTemplate[]> {
    const query: WorkflowTemplateQuery = {
      limit,
      orderBy: 'createdAt',
      orderDirection: 'desc'
    };

    const result = await workflowManagementService.getTemplates(query);
    return result.templates;
  }

  async getTemplatesByCategory(category: string): Promise<WorkflowTemplate[]> {
    const query: WorkflowTemplateQuery = {
      category: category as any,
      status: 'active'
    };

    const result = await workflowManagementService.getTemplates(query);
    return result.templates;
  }

  /**
   * TEMPLATE IMPORT/EXPORT OPERATIONS
   */

  async exportTemplate(templateId: string, userId: string): Promise<WorkflowTemplateExport> {
    // Get template with all related data
    const template = await workflowManagementService.getTemplateById(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    const phases = await workflowManagementService.getPhases(templateId);
    const steps: any[] = [];
    const tasks: any[] = [];

    // Get all steps and tasks for each phase
    for (const phase of phases) {
      const phaseSteps = await workflowManagementService.getSteps(phase.id);
      steps.push(...phaseSteps);

      for (const step of phaseSteps) {
        const stepTasks = await workflowManagementService.getTasks(step.id);
        tasks.push(...stepTasks);
      }
    }

    return {
      template,
      phases,
      steps,
      tasks,
      exportedAt: new Date().toISOString(),
      exportedBy: userId,
      version: '1.0'
    };
  }

  async importTemplate(templateData: WorkflowTemplateExport, userId: string): Promise<TemplateImportResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Validate import data structure
      if (!templateData.template || !templateData.phases) {
        errors.push('Invalid template data structure');
        return { success: false, errors };
      }

      // Check if template name already exists
      const existingTemplates = await workflowManagementService.getTemplates({
        search: templateData.template.name
      });

      if (existingTemplates.templates.some(t => t.name === templateData.template.name)) {
        warnings.push('Template name already exists, will be imported with suffix');
        templateData.template.name += ` (Imported ${new Date().toLocaleDateString()})`;
      }

      // Start import process
      const newTemplate = await workflowManagementService.createTemplate({
        name: templateData.template.name,
        description: templateData.template.description,
        category: templateData.template.category,
        type: 'custom', // Always import as custom
        tags: templateData.template.tags,
        metadata: {
          ...templateData.template.metadata,
          importedFrom: templateData.exportedBy,
          importedAt: new Date().toISOString(),
          originalId: templateData.template.id
        }
      }, userId);

      // Create phase mapping (old ID -> new ID)
      const phaseIdMap = new Map<string, string>();
      const stepIdMap = new Map<string, string>();

      // Import phases
      for (const phase of templateData.phases) {
        try {
          const newPhase = await workflowManagementService.createPhase({
            workflowTemplateId: newTemplate.id,
            name: phase.name,
            description: phase.description,
            orderIndex: phase.orderIndex,
            color: phase.color,
            icon: phase.icon,
            estimatedDuration: phase.estimatedDuration,
            requiredRoles: phase.requiredRoles,
            dependencies: [], // Will be updated after all phases are created
            completionCriteria: phase.completionCriteria,
            isOptional: phase.isOptional,
            isParallel: phase.isParallel,
            metadata: phase.metadata
          });

          phaseIdMap.set(phase.id, newPhase.id);
        } catch (error) {
          errors.push(`Failed to import phase "${phase.name}": ${error}`);
        }
      }

      // Import steps
      for (const step of templateData.steps) {
        const newPhaseId = phaseIdMap.get(step.workflowPhaseId);
        if (!newPhaseId) {
          warnings.push(`Skipping step "${step.name}" - phase not found`);
          continue;
        }

        try {
          const newStep = await workflowManagementService.createStep({
            workflowPhaseId: newPhaseId,
            name: step.name,
            description: step.description,
            orderIndex: step.orderIndex,
            stepType: step.stepType,
            estimatedDuration: step.estimatedDuration,
            assigneeRole: step.assigneeRole,
            dependencies: [], // Will be updated after all steps are created
            preconditions: step.preconditions,
            postconditions: step.postconditions,
            instructions: step.instructions,
            resources: step.resources,
            validation: step.validation,
            isRequired: step.isRequired,
            isAutomated: step.isAutomated,
            automationConfig: step.automationConfig,
            metadata: step.metadata
          });

          stepIdMap.set(step.id, newStep.id);
        } catch (error) {
          errors.push(`Failed to import step "${step.name}": ${error}`);
        }
      }

      // Import tasks
      for (const task of templateData.tasks) {
        const newStepId = stepIdMap.get(task.workflowStepId);
        if (!newStepId) {
          warnings.push(`Skipping task "${task.name}" - step not found`);
          continue;
        }

        try {
          await workflowManagementService.createTask({
            workflowStepId: newStepId,
            name: task.name,
            description: task.description,
            orderIndex: task.orderIndex,
            priority: task.priority,
            estimatedHours: task.estimatedHours,
            skillsRequired: task.skillsRequired,
            tools: task.tools,
            deliverables: task.deliverables,
            acceptanceCriteria: task.acceptanceCriteria,
            isOptional: task.isOptional,
            canBeParallel: task.canBeParallel,
            tags: task.tags,
            metadata: task.metadata
          });
        } catch (error) {
          errors.push(`Failed to import task "${task.name}": ${error}`);
        }
      }

      // Update phase dependencies with new IDs
      for (const phase of templateData.phases) {
        const newPhaseId = phaseIdMap.get(phase.id);
        if (newPhaseId && phase.dependencies.length > 0) {
          const newDependencies = phase.dependencies
            .map(depId => phaseIdMap.get(depId))
            .filter(Boolean);

          if (newDependencies.length > 0) {
            try {
              await workflowManagementService.updatePhase(newPhaseId, {
                dependencies: newDependencies
              });
            } catch (error) {
              warnings.push(`Failed to update dependencies for phase "${phase.name}"`);
            }
          }
        }
      }

      // Update step dependencies with new IDs
      for (const step of templateData.steps) {
        const newStepId = stepIdMap.get(step.id);
        if (newStepId && step.dependencies.length > 0) {
          const newDependencies = step.dependencies
            .map(depId => stepIdMap.get(depId))
            .filter(Boolean);

          if (newDependencies.length > 0) {
            try {
              await workflowManagementService.updateStep(newStepId, {
                dependencies: newDependencies
              });
            } catch (error) {
              warnings.push(`Failed to update dependencies for step "${step.name}"`);
            }
          }
        }
      }

      return {
        success: true,
        templateId: newTemplate.id,
        errors,
        warnings
      };

    } catch (error) {
      errors.push(`Import failed: ${error}`);
      return { success: false, errors, warnings };
    }
  }

  /**
   * TEMPLATE CLONING AND VERSIONING
   */

  async createTemplateVersion(templateId: string, newVersion: string, userId: string): Promise<WorkflowTemplate> {
    const template = await workflowManagementService.getTemplateById(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    // Create new version by duplicating and updating version
    const newTemplate = await workflowManagementService.duplicateTemplate(
      templateId, 
      `${template.name} v${newVersion}`, 
      userId
    );

    // Update the version field
    return await workflowManagementService.updateTemplate(newTemplate.id, {
      version: newVersion,
      metadata: {
        ...newTemplate.metadata,
        previousVersion: template.version,
        versionHistory: [
          ...(template.metadata?.versionHistory || []),
          {
            version: template.version,
            createdAt: template.updatedAt,
            createdBy: template.updatedBy
          }
        ]
      }
    }, userId);
  }

  async getTemplateVersions(templateName: string): Promise<WorkflowTemplate[]> {
    const query: WorkflowTemplateQuery = {
      search: templateName,
      orderBy: 'version',
      orderDirection: 'desc'
    };

    const result = await workflowManagementService.getTemplates(query);
    return result.templates.filter(t => 
      t.name.includes(templateName) || t.name.startsWith(templateName)
    );
  }

  /**
   * TEMPLATE RECOMMENDATIONS
   */

  async getRecommendedTemplates(
    projectType?: string, 
    industry?: string, 
    complexity?: string
  ): Promise<WorkflowTemplate[]> {
    // Simple recommendation logic based on metadata and usage
    const templates = await workflowManagementService.getTemplates({
      status: 'active',
      limit: 50
    });

    const scored = templates.templates.map(template => {
      let score = 0;

      // Base score from usage
      score += (template.projectCount || 0) * 2;

      // Score based on project type match
      if (projectType && template.category === projectType) {
        score += 10;
      }

      // Score based on metadata matches
      if (template.metadata) {
        if (industry && template.metadata.industry === industry) {
          score += 8;
        }
        if (complexity && template.metadata.complexity === complexity) {
          score += 6;
        }
      }

      // Boost default templates
      if (template.isDefault) {
        score += 5;
      }

      // Boost recently updated templates
      const daysSinceUpdate = Math.floor(
        (new Date().getTime() - new Date(template.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceUpdate < 30) {
        score += 3;
      }

      return { template, score };
    });

    // Sort by score and return top 10
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10).map(item => item.template);
  }

  /**
   * TEMPLATE COMPARISON
   */

  async compareTemplates(templateId1: string, templateId2: string): Promise<{
    template1: WorkflowTemplate;
    template2: WorkflowTemplate;
    comparison: {
      phaseCount: { template1: number; template2: number };
      avgStepsPerPhase: { template1: number; template2: number };
      avgTasksPerStep: { template1: number; template2: number };
      estimatedDuration: { template1: number; template2: number };
      complexity: { template1: string; template2: string };
      similarities: string[];
      differences: string[];
    };
  }> {
    const [template1, template2] = await Promise.all([
      workflowManagementService.getTemplateById(templateId1),
      workflowManagementService.getTemplateById(templateId2)
    ]);

    if (!template1 || !template2) {
      throw new Error('One or both templates not found');
    }

    const [phases1, phases2] = await Promise.all([
      workflowManagementService.getPhases(templateId1),
      workflowManagementService.getPhases(templateId2)
    ]);

    // Get steps and tasks for calculation
    const steps1: any[] = [];
    const tasks1: any[] = [];
    const steps2: any[] = [];
    const tasks2: any[] = [];

    for (const phase of phases1) {
      const phaseSteps = await workflowManagementService.getSteps(phase.id);
      steps1.push(...phaseSteps);
      for (const step of phaseSteps) {
        const stepTasks = await workflowManagementService.getTasks(step.id);
        tasks1.push(...stepTasks);
      }
    }

    for (const phase of phases2) {
      const phaseSteps = await workflowManagementService.getSteps(phase.id);
      steps2.push(...phaseSteps);
      for (const step of phaseSteps) {
        const stepTasks = await workflowManagementService.getTasks(step.id);
        tasks2.push(...stepTasks);
      }
    }

    // Calculate metrics
    const avgStepsPerPhase1 = phases1.length > 0 ? steps1.length / phases1.length : 0;
    const avgStepsPerPhase2 = phases2.length > 0 ? steps2.length / phases2.length : 0;
    const avgTasksPerStep1 = steps1.length > 0 ? tasks1.length / steps1.length : 0;
    const avgTasksPerStep2 = steps2.length > 0 ? tasks2.length / steps2.length : 0;

    const estimatedDuration1 = phases1.reduce((sum, p) => sum + (p.estimatedDuration || 0), 0);
    const estimatedDuration2 = phases2.reduce((sum, p) => sum + (p.estimatedDuration || 0), 0);

    // Find similarities and differences
    const similarities: string[] = [];
    const differences: string[] = [];

    if (template1.category === template2.category) {
      similarities.push(`Both templates are for ${template1.category} projects`);
    } else {
      differences.push(`Different categories: ${template1.category} vs ${template2.category}`);
    }

    const commonPhases = phases1.filter(p1 => 
      phases2.some(p2 => p1.name.toLowerCase() === p2.name.toLowerCase())
    );
    if (commonPhases.length > 0) {
      similarities.push(`${commonPhases.length} similar phase names: ${commonPhases.map(p => p.name).join(', ')}`);
    }

    if (Math.abs(phases1.length - phases2.length) > 2) {
      differences.push(`Significantly different number of phases: ${phases1.length} vs ${phases2.length}`);
    }

    return {
      template1,
      template2,
      comparison: {
        phaseCount: { template1: phases1.length, template2: phases2.length },
        avgStepsPerPhase: { template1: avgStepsPerPhase1, template2: avgStepsPerPhase2 },
        avgTasksPerStep: { template1: avgTasksPerStep1, template2: avgTasksPerStep2 },
        estimatedDuration: { template1: estimatedDuration1, template2: estimatedDuration2 },
        complexity: { 
          template1: template1.metadata?.complexity || 'unknown', 
          template2: template2.metadata?.complexity || 'unknown' 
        },
        similarities,
        differences
      }
    };
  }

  /**
   * TEMPLATE OPTIMIZATION SUGGESTIONS
   */

  async getOptimizationSuggestions(templateId: string): Promise<{
    suggestions: Array<{
      type: 'performance' | 'structure' | 'best_practice';
      priority: 'low' | 'medium' | 'high';
      title: string;
      description: string;
      impact: string;
    }>;
  }> {
    const template = await workflowManagementService.getTemplateById(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    const phases = await workflowManagementService.getPhases(templateId);
    const validation = await workflowManagementService.validateTemplate(templateId);
    
    const suggestions: any[] = [];

    // Performance suggestions
    if (phases.length > 8) {
      suggestions.push({
        type: 'performance',
        priority: 'medium',
        title: 'Consider consolidating phases',
        description: `Template has ${phases.length} phases. Consider combining similar phases for better manageability.`,
        impact: 'Reduced complexity and better overview'
      });
    }

    // Structure suggestions
    const parallelPhases = phases.filter(p => p.isParallel);
    if (parallelPhases.length === 0 && phases.length > 3) {
      suggestions.push({
        type: 'structure',
        priority: 'medium',
        title: 'Add parallel execution opportunities',
        description: 'No phases are marked as parallel. Consider identifying phases that can run concurrently.',
        impact: 'Reduced overall project duration'
      });
    }

    // Best practice suggestions
    if (validation.warnings.length > 0) {
      suggestions.push({
        type: 'best_practice',
        priority: 'high',
        title: 'Address validation warnings',
        description: `Template has ${validation.warnings.length} validation warnings that should be addressed.`,
        impact: 'Improved template quality and reliability'
      });
    }

    const phasesWithoutEstimates = phases.filter(p => !p.estimatedDuration);
    if (phasesWithoutEstimates.length > 0) {
      suggestions.push({
        type: 'best_practice',
        priority: 'medium',
        title: 'Add duration estimates',
        description: `${phasesWithoutEstimates.length} phases lack duration estimates.`,
        impact: 'Better project planning and timeline accuracy'
      });
    }

    return { suggestions };
  }
}

// Export singleton instance
export const workflowTemplateService = new WorkflowTemplateService();