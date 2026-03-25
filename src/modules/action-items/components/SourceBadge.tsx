/**
 * Source Badge — shows where an action item came from.
 * All colours use existing design system CSS variable tokens for light/dark mode safety.
 */

import { Users, ShoppingCart, Wrench, Shield, ClipboardCheck, FolderOpen, PenTool } from 'lucide-react';

// 🟢 WORKING: All tokens verified to exist in design-system.css
// --ff-info / --ff-info-light, --ff-warning / --ff-warning-light, --ff-error / --ff-error-light
// No --ff-accent-* tokens exist; QA uses info colours as closest match.
const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  meeting:     { label: 'Meeting',     color: 'bg-[var(--ff-info-light)] text-[var(--ff-info)]',        icon: Users },
  procurement: { label: 'Procurement', color: 'bg-[var(--ff-warning-light)] text-[var(--ff-warning)]',  icon: ShoppingCart },
  noc:         { label: 'NOC',         color: 'bg-[var(--ff-error-light)] text-[var(--ff-error)]',      icon: Wrench },
  hns:         { label: 'H&S',         color: 'bg-[var(--ff-warning-light)] text-[var(--ff-warning)]',  icon: Shield },
  qa:          { label: 'QA',          color: 'bg-[var(--ff-info-light)] text-[var(--ff-info)]',        icon: ClipboardCheck },
  project:     { label: 'Project',     color: 'bg-[var(--ff-info-light)] text-[var(--ff-info)]',        icon: FolderOpen },
  manual:      { label: 'Manual',      color: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]', icon: PenTool },
};

interface SourceBadgeProps {
  source?: string;
  inline?: boolean;
}

export function SourceBadge({ source, inline }: SourceBadgeProps) {
  const config = SOURCE_CONFIG[source || 'meeting'] ?? SOURCE_CONFIG['meeting']!;
  const Icon = config.icon;

  if (inline) {
    return (
      <span className="flex items-center gap-1">
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {config.label}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${config.color}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {config.label}
    </span>
  );
}
