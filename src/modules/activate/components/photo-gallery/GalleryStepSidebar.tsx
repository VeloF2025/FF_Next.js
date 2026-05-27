import { STEP_LABELS } from './types';

interface GalleryStepSidebarProps {
  activeStep: number;
  stepCounts: Record<number, number>;
  onSelectStep: (step: number) => void;
}

/** Left rail listing the 10 install steps with per-step photo counts. */
export function GalleryStepSidebar({ activeStep, stepCounts, onSelectStep }: GalleryStepSidebarProps) {
  return (
    <div className="w-52 shrink-0 overflow-y-auto border-r border-gray-800 bg-gray-900 py-2">
      {Object.entries(STEP_LABELS).map(([stepStr, label]) => {
        const step = parseInt(stepStr, 10);
        const count = stepCounts[step] ?? 0;
        const isActive = activeStep === step;
        return (
          <button
            key={step}
            onClick={() => onSelectStep(step)}
            className={`w-full px-4 py-3 text-left transition-colors ${
              isActive
                ? 'bg-blue-900/40 border-l-2 border-blue-500 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white border-l-2 border-transparent'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Step {step}
              </span>
              <span
                className={`text-xs rounded px-1.5 py-0.5 ${count > 0 ? 'bg-gray-700 text-gray-300' : 'text-gray-600'}`}
              >
                {count}
              </span>
            </div>
            <p className="mt-0.5 text-sm leading-tight">{label}</p>
          </button>
        );
      })}
    </div>
  );
}
