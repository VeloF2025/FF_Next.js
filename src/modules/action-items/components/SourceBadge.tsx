/**
 * Source Badge — shows where an action item came from
 */

import { Users, ShoppingCart, Wrench, Shield, ClipboardCheck, FolderOpen, PenTool } from 'lucide-react';

const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  meeting: { label: 'Meeting', color: 'bg-blue-500/15 text-blue-400', icon: Users },
  procurement: { label: 'Procurement', color: 'bg-amber-500/15 text-amber-400', icon: ShoppingCart },
  noc: { label: 'NOC', color: 'bg-red-500/15 text-red-400', icon: Wrench },
  hns: { label: 'H&S', color: 'bg-orange-500/15 text-orange-400', icon: Shield },
  qa: { label: 'QA', color: 'bg-purple-500/15 text-purple-400', icon: ClipboardCheck },
  project: { label: 'Project', color: 'bg-cyan-500/15 text-cyan-400', icon: FolderOpen },
  manual: { label: 'Manual', color: 'bg-gray-500/15 text-gray-400', icon: PenTool },
};

interface SourceBadgeProps {
  source?: string;
  inline?: boolean;
}

export function SourceBadge({ source, inline }: SourceBadgeProps) {
  const config = SOURCE_CONFIG[source || 'meeting'] || SOURCE_CONFIG.meeting;
  const Icon = config.icon;

  if (inline) {
    return (
      <span className="flex items-center gap-1">
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${config.color}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}
