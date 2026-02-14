import { MapPin, GitMerge, Cable, Home, Hexagon, Box, Radio, HelpCircle } from 'lucide-react';
import type { LayerType, LayerPreview } from '../types';

interface LayerPreviewCardProps {
  layerType: LayerType;
  preview: LayerPreview;
  selected: boolean;
  onToggle: () => void;
}

const LAYER_CONFIG: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  poles: { label: 'Poles', icon: MapPin },
  joints: { label: 'Joints', icon: GitMerge },
  cable_spans: { label: 'Cable Spans', icon: Cable },
  drops: { label: 'Drops', icon: Home },
  zone_boundaries: { label: 'Zone Boundaries', icon: Hexagon },
  pon_boundaries: { label: 'PON Boundaries', icon: Box },
  pops: { label: 'POPs', icon: Radio },
};

const FALLBACK_CONFIG = { label: 'Unknown', icon: HelpCircle };

export function LayerPreviewCard({
  layerType,
  preview,
  selected,
  onToggle,
}: LayerPreviewCardProps) {
  const config = LAYER_CONFIG[layerType] || FALLBACK_CONFIG;
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full text-left p-4 rounded-lg border transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              selected ? 'bg-blue-500/20' : 'bg-[var(--ff-bg-tertiary)]'
            }`}
          >
            <Icon
              className={`w-4 h-4 ${selected ? 'text-blue-400' : 'text-[var(--ff-text-secondary)]'}`}
            />
          </div>
          <span className="text-sm font-medium text-[var(--ff-text-primary)]">
            {config.label}
          </span>
        </div>

        {/* Toggle indicator */}
        <div
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            selected
              ? 'border-blue-500 bg-blue-500'
              : 'border-[var(--ff-border-light)] bg-transparent'
          }`}
        >
          {selected && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Record count badge */}
      <div className="flex items-center gap-2 mt-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            selected
              ? 'bg-blue-500/20 text-blue-300'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
          }`}
        >
          {preview.count.toLocaleString()} records
        </span>
      </div>

      {/* Sample fields */}
      {preview.sample_fields.length > 0 && (
        <p className="mt-2 text-xs text-[var(--ff-text-tertiary)] truncate">
          Fields: {preview.sample_fields.slice(0, 4).join(', ')}
          {preview.sample_fields.length > 4 && ` +${preview.sample_fields.length - 4} more`}
        </p>
      )}
    </button>
  );
}
