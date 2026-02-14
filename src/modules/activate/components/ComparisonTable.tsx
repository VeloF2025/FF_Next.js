/**
 * ComparisonTable Component
 *
 * Side-by-side comparison of manual QA vs AI evaluation results
 *
 * Features:
 * - Step-by-step comparison with visual indicators
 * - Agreement/disagreement highlighting
 * - AI scores and comments display
 * - Overall agreement percentage
 * - Responsive table layout
 *
 * Following FibreFlow UI/UX patterns with TailwindCSS
 */

'use client';

import { STEP_LABELS } from '../types/unified.types';

interface ManualStep {
  step: number;
  passed: boolean;
}

interface AIStepResult {
  step: number;
  passed: boolean;
  score: number;
  comment?: string;
}

interface ComparisonTableProps {
  manualSteps: ManualStep[];
  aiSteps: AIStepResult[];
}

type ComparisonStatus = 'agree-pass' | 'agree-fail' | 'disagree-manual-pass' | 'disagree-ai-pass' | 'no-ai-data';

interface ComparisonRow {
  step: number;
  label: string;
  manualPassed: boolean;
  aiPassed: boolean | null;
  aiScore: number | null;
  aiComment: string | null;
  status: ComparisonStatus;
}

export function ComparisonTable({ manualSteps, aiSteps }: ComparisonTableProps) {
  // Build comparison rows
  const comparisonRows: ComparisonRow[] = manualSteps.map((manualStep) => {
    const aiStep = aiSteps.find((ai) => ai.step === manualStep.step);

    let status: ComparisonStatus;
    if (!aiStep) {
      status = 'no-ai-data';
    } else if (manualStep.passed && aiStep.passed) {
      status = 'agree-pass';
    } else if (!manualStep.passed && !aiStep.passed) {
      status = 'agree-fail';
    } else if (manualStep.passed && !aiStep.passed) {
      status = 'disagree-ai-pass';
    } else {
      status = 'disagree-manual-pass';
    }

    return {
      step: manualStep.step,
      label: STEP_LABELS[manualStep.step] || `Step ${manualStep.step}`,
      manualPassed: manualStep.passed,
      aiPassed: aiStep?.passed ?? null,
      aiScore: aiStep?.score ?? null,
      aiComment: aiStep?.comment ?? null,
      status,
    };
  });

  // Calculate agreement statistics
  const totalSteps = comparisonRows.length;
  const stepsWithAI = comparisonRows.filter((row) => row.aiPassed !== null).length;
  const agreements = comparisonRows.filter((row) =>
    row.status === 'agree-pass' || row.status === 'agree-fail'
  ).length;
  const disagreements = comparisonRows.filter((row) =>
    row.status === 'disagree-manual-pass' || row.status === 'disagree-ai-pass'
  ).length;
  const agreementPercentage = stepsWithAI > 0 ? (agreements / stepsWithAI) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Statistics Header */}
      <div className="bg-background rounded-lg p-4 border border-border">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Steps"
            value={totalSteps}
            color="text-foreground"
          />
          <StatCard
            label="Agreement"
            value={`${agreements}/${stepsWithAI}`}
            subValue={`${agreementPercentage.toFixed(0)}%`}
            color="text-green-600"
          />
          <StatCard
            label="Disagreement"
            value={disagreements}
            color="text-orange-600"
          />
          <StatCard
            label="No AI Data"
            value={totalSteps - stepsWithAI}
            color="text-muted-foreground"
          />
        </div>
      </div>

      {/* Comparison Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-background">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">
                  Step
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">
                  Manual QA
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">
                  AI Evaluation
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">
                  AI Score
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">
                  AI Comment
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-gray-200">
              {comparisonRows.map((row) => (
                <ComparisonRow key={row.step} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-background rounded-lg p-4 border border-border">
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Legend</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <LegendItem
            color="bg-green-100 text-green-800"
            label="Agree - Pass"
            description="Both manual and AI passed"
          />
          <LegendItem
            color="bg-red-100 text-red-800"
            label="Agree - Fail"
            description="Both manual and AI failed"
          />
          <LegendItem
            color="bg-orange-100 text-orange-800"
            label="Disagree"
            description="Manual and AI results differ"
          />
          <LegendItem
            color="bg-secondary text-muted-foreground"
            label="No AI Data"
            description="AI evaluation not available"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Stat Card
 * Display statistic with label and optional sub-value
 */
interface StatCardProps {
  label: string;
  value: number | string;
  subValue?: string;
  color: string;
}

function StatCard({ label, value, subValue, color }: StatCardProps) {
  return (
    <div className="text-center">
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>
        {value}
      </p>
      {subValue && (
        <p className={`text-xs font-medium ${color}`}>
          {subValue}
        </p>
      )}
    </div>
  );
}

/**
 * Comparison Row
 * Individual row showing manual vs AI comparison for one step
 */
interface ComparisonRowProps {
  row: ComparisonRow;
}

function ComparisonRow({ row }: ComparisonRowProps) {
  const getStatusBadge = (): { label: string; color: string } => {
    switch (row.status) {
      case 'agree-pass':
        return { label: '✓ Agree', color: 'bg-green-100 text-green-800' };
      case 'agree-fail':
        return { label: '✗ Agree', color: 'bg-red-100 text-red-800' };
      case 'disagree-manual-pass':
        return { label: '⚠ Disagree', color: 'bg-orange-100 text-orange-800' };
      case 'disagree-ai-pass':
        return { label: '⚠ Disagree', color: 'bg-orange-100 text-orange-800' };
      case 'no-ai-data':
        return { label: '— No Data', color: 'bg-secondary text-muted-foreground' };
    }
  };

  const statusBadge = getStatusBadge();

  // Row background color based on status
  const getRowBgColor = (): string => {
    switch (row.status) {
      case 'agree-pass':
        return 'bg-green-50';
      case 'agree-fail':
        return 'bg-red-50';
      case 'disagree-manual-pass':
      case 'disagree-ai-pass':
        return 'bg-orange-50';
      case 'no-ai-data':
        return 'bg-card';
    }
  };

  return (
    <tr className={getRowBgColor()}>
      {/* Step */}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-800 text-sm font-semibold">
            {row.step}
          </span>
          <span className="text-sm font-medium text-foreground">
            {row.label}
          </span>
        </div>
      </td>

      {/* Manual QA */}
      <td className="px-4 py-3 whitespace-nowrap">
        <PassFailBadge passed={row.manualPassed} />
      </td>

      {/* AI Evaluation */}
      <td className="px-4 py-3 whitespace-nowrap">
        {row.aiPassed !== null ? (
          <PassFailBadge passed={row.aiPassed} />
        ) : (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground">
            No Data
          </span>
        )}
      </td>

      {/* AI Score */}
      <td className="px-4 py-3 whitespace-nowrap">
        {row.aiScore !== null ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {row.aiScore.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">/10</span>
            <ScoreBar score={row.aiScore} />
          </div>
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </td>

      {/* AI Comment */}
      <td className="px-4 py-3">
        {row.aiComment ? (
          <p className="text-sm text-muted-foreground max-w-md">
            {row.aiComment}
          </p>
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge.color}`}>
          {statusBadge.label}
        </span>
      </td>
    </tr>
  );
}

/**
 * Pass/Fail Badge
 * Visual indicator for pass or fail status
 */
interface PassFailBadgeProps {
  passed: boolean;
}

function PassFailBadge({ passed }: PassFailBadgeProps) {
  if (passed) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        ✓ Pass
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
      ✗ Fail
    </span>
  );
}

/**
 * Score Bar
 * Visual bar indicator for AI score (0-10)
 */
interface ScoreBarProps {
  score: number;
}

function ScoreBar({ score }: ScoreBarProps) {
  const percentage = (score / 10) * 100;

  // Color based on score
  const getColor = (): string => {
    if (score >= 8) return 'bg-green-500';
    if (score >= 6) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex-1 max-w-[100px] h-2 bg-secondary rounded-full overflow-hidden">
      <div
        className={`h-full ${getColor()} transition-all duration-300`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

/**
 * Legend Item
 * Single legend entry explaining status colors
 */
interface LegendItemProps {
  color: string;
  label: string;
  description: string;
}

function LegendItem({ color, label, description }: LegendItemProps) {
  return (
    <div className="flex items-start gap-2">
      <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${color} shrink-0`}>
        {label}
      </span>
      <span className="text-xs text-muted-foreground">
        {description}
      </span>
    </div>
  );
}
