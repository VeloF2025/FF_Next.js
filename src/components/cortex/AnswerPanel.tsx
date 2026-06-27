import { confidenceLabel, gapLabel, type AnswerGap } from '@/lib/cortex/answerFormat';

/** Tailwind classes for the confidence badge, keyed by bridge level (defaults muted). */
function confidenceBadgeClass(confidence: string): string {
  switch (confidence) {
    case 'high':
      return 'text-emerald-600 dark:text-emerald-500 bg-emerald-500/10';
    case 'medium':
      return 'text-amber-600 dark:text-amber-500 bg-amber-500/10';
    case 'low':
      return 'text-red-600 dark:text-red-500 bg-red-500/10';
    default:
      return 'text-muted-foreground bg-muted';
  }
}

interface AnswerPanelProps {
  answer: string;
  confidence: string;
  confidenceReason: string;
  gaps: AnswerGap[];
}

/**
 * Grounded answer block: confidence badge + answer text + evidence-gap list.
 * Rendered only when an answer is present. Pure presentational — no client hooks,
 * so it stays a server-importable component (no 'use client' directive).
 */
export function AnswerPanel({ answer, confidence, confidenceReason, gaps }: AnswerPanelProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border border-l-2 border-l-primary bg-background p-3">
      {confidence && (
        <span
          className={`inline-block w-fit rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${confidenceBadgeClass(confidence)}`}
          title={confidenceReason || undefined}
        >
          {confidenceLabel(confidence)}
        </span>
      )}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{answer}</p>
      {gaps.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {gaps.map((g, i) => (
            <li key={`${g.type}-${i}`} className="flex items-baseline gap-2 text-xs leading-snug">
              <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                {gapLabel(g.type)}
              </span>
              <span className="text-muted-foreground">{g.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
