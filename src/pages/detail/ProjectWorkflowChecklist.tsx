/**
 * Project Workflow Checklist (PRD-058)
 * Shows requirements needed for current project stage completion
 */

import { useState } from 'react';
import { CheckCircle2, Circle, Loader2, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { log } from '@/lib/logger';
import { useProjectRequirements, completeRequirement, ProjectRequirement } from '@/hooks/useProjectOverview';
import { useQueryClient } from '@tanstack/react-query';
import { formatDisplayDate } from '@/utils/dateFormat';

interface ProjectWorkflowChecklistProps {
  projectId: string;
  projectStatus: string;
}

// Map project status to workflow stage
function getStageFromStatus(status: string): string {
  const s = status?.toLowerCase() || 'planning';
  if (s === 'pipeline' || s === 'prospect') return 'pipeline';
  if (s === 'planning' || s === 'planned') return 'planning';
  if (s === 'active' || s === 'in_progress' || s === 'execution') return 'execution';
  if (s === 'completed' || s === 'closure') return 'closure';
  return 'planning';
}

// Get title based on stage
function getChecklistTitle(stage: string): string {
  switch (stage) {
    case 'pipeline':
      return 'What\'s Needed for Planning';
    case 'planning':
      return 'What\'s Needed to Start';
    case 'execution':
      return 'What\'s Needed for Completion';
    case 'closure':
      return 'Closure Checklist';
    default:
      return 'Requirements';
  }
}

export function ProjectWorkflowChecklist({ projectId, projectStatus }: ProjectWorkflowChecklistProps) {
  const queryClient = useQueryClient();
  const currentStage = getStageFromStatus(projectStatus);
  const [expandedStages, setExpandedStages] = useState<string[]>([currentStage]);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const { data, isLoading, error } = useProjectRequirements(projectId);

  const toggleStage = (stage: string) => {
    setExpandedStages(prev =>
      prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]
    );
  };

  const handleComplete = async (requirement: ProjectRequirement) => {
    if (requirement.isCompleted) return;

    setCompletingId(requirement.id);
    try {
      await completeRequirement(projectId, requirement.id);
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['project-requirements', projectId] });
    } catch (err) {
      log.warn('ProjectWorkflowChecklist', { action: 'completeRequirementFailed', requirementId: requirement.id, error: err });
    } finally {
      setCompletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--ff-text-tertiary)]" />
          <span className="text-sm text-[var(--ff-text-secondary)]">Loading requirements...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <p className="text-sm text-[var(--ff-text-secondary)]">
          No workflow requirements configured
        </p>
      </div>
    );
  }

  const { requirements, summary } = data;

  // Group requirements by stage
  const stages = ['pipeline', 'planning', 'execution', 'closure'];
  const requirementsByStage = stages.reduce((acc, stage) => {
    acc[stage] = requirements.filter(r => r.stage === stage);
    return acc;
  }, {} as Record<string, ProjectRequirement[]>);

  // Get current stage requirements for main display
  const currentRequirements = requirementsByStage[currentStage] || [];
  const currentCompleted = currentRequirements.filter(r => r.isCompleted).length;
  const currentTotal = currentRequirements.length;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
      {/* Header with summary */}
      <div className="p-4 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {getChecklistTitle(currentStage)}
          </h3>
          <span className="text-sm text-[var(--ff-text-secondary)]">
            {currentCompleted}/{currentTotal} complete
          </span>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-300"
            style={{ width: `${currentTotal > 0 ? (currentCompleted / currentTotal) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Current stage requirements */}
      <div className="p-4 space-y-2">
        {currentRequirements.length === 0 ? (
          <p className="text-sm text-[var(--ff-text-secondary)] py-2">
            No requirements for this stage
          </p>
        ) : (
          currentRequirements.map(req => (
            <RequirementItem
              key={req.id}
              requirement={req}
              isCompleting={completingId === req.id}
              onComplete={() => handleComplete(req)}
            />
          ))
        )}
      </div>

      {/* Other stages (collapsible) */}
      {stages.filter(s => s !== currentStage && (requirementsByStage[s]?.length || 0) > 0).map(stage => {
        const stageReqs = requirementsByStage[stage] || [];
        const stageCompleted = stageReqs.filter(r => r.isCompleted).length;
        const isExpanded = expandedStages.includes(stage);

        return (
          <div key={stage} className="border-t border-[var(--ff-border-light)]">
            <button
              onClick={() => toggleStage(stage)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                )}
                <span className="text-sm font-medium text-[var(--ff-text-primary)] capitalize">
                  {stage} Stage
                </span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                stageCompleted === stageReqs.length
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
              }`}>
                {stageCompleted}/{stageReqs.length}
              </span>
            </button>

            {isExpanded && stageReqs.length > 0 && (
              <div className="px-4 pb-3 space-y-2">
                {stageReqs.map(req => (
                  <RequirementItem
                    key={req.id}
                    requirement={req}
                    isCompleting={completingId === req.id}
                    onComplete={() => handleComplete(req)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Individual requirement item
interface RequirementItemProps {
  requirement: ProjectRequirement;
  isCompleting: boolean;
  onComplete: () => void;
}

function RequirementItem({ requirement, isCompleting, onComplete }: RequirementItemProps) {
  const { isCompleted, requirementName, expiryDate, documentUrl } = requirement;

  // Calculate if expiring soon
  const isExpiringSoon = expiryDate && new Date(expiryDate) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const isExpired = expiryDate && new Date(expiryDate) < new Date();

  return (
    <div className={`flex items-start gap-3 p-2 rounded-md ${
      isCompleted ? 'bg-green-500/5' : 'hover:bg-[var(--ff-bg-tertiary)]'
    }`}>
      <button
        onClick={onComplete}
        disabled={isCompleted || isCompleting}
        className="mt-0.5 flex-shrink-0"
      >
        {isCompleting ? (
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        ) : isCompleted ? (
          <CheckCircle2 className="w-5 h-5 text-green-500" />
        ) : (
          <Circle className="w-5 h-5 text-[var(--ff-text-tertiary)] hover:text-blue-500 transition-colors" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p className={`text-sm ${
          isCompleted
            ? 'text-[var(--ff-text-secondary)] line-through'
            : 'text-[var(--ff-text-primary)]'
        }`}>
          {requirementName}
        </p>

        {expiryDate && (
          <p className={`text-xs mt-0.5 ${
            isExpired ? 'text-red-500' :
            isExpiringSoon ? 'text-yellow-500' :
            'text-[var(--ff-text-tertiary)]'
          }`}>
            {isExpired ? 'Expired: ' : isExpiringSoon ? 'Expiring: ' : 'Expires: '}
            {formatDisplayDate(expiryDate)}
          </p>
        )}
      </div>

      {documentUrl && (
        <a
          href={documentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 p-1 text-[var(--ff-text-tertiary)] hover:text-blue-500 transition-colors"
          title="View document"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}
