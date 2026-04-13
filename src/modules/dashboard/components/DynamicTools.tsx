'use client';

import { useState, useEffect, type ComponentType } from 'react';
import Link from 'next/link';
import {
  HardHat, Package, Wrench, BarChart3, Zap, FolderOpen,
  Users, MapPin, FileText, Truck, Activity, Box, Cable,
  MessageSquare, Building2, CheckSquare, Settings, LayoutDashboard,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { log } from '@/lib/logger';
import { ROLE_DEFAULT_TOOLS, ROUTE_MODULE_MAP, getModuleFromRoute } from '../config/roleDefaultTools';
import type { DefaultTool } from '../config/roleDefaultTools';

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  HardHat, Package, Wrench, BarChart3, Zap, FolderOpen,
  Users, MapPin, FileText, Truck, Activity, Box, Cable,
  MessageSquare, Building2, CheckSquare, Settings, LayoutDashboard,
};

const MAX_TOOLS = 6;

export function DynamicTools() {
  const { currentUser } = useAuth();
  const [tools, setTools] = useState<DefaultTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'role_defaults' | 'usage'>('role_defaults');

  useEffect(() => {
    if (!currentUser) return;
    const userRole = currentUser.role;

    async function fetchTools() {
      try {
        const res = await fetch('/api/dashboard/quick-links');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();

        if (data.data?.source === 'usage' && data.data.tools?.length > 0) {
          // Map usage routes to tool cards
          const usageTools: DefaultTool[] = data.data.tools
            .map((t: { route: string }) => {
              const moduleKey = getModuleFromRoute(t.route);
              const moduleInfo = ROUTE_MODULE_MAP[moduleKey];
              if (!moduleInfo || moduleKey === '/dashboard') return null;
              return {
                route: t.route,
                label: moduleInfo.label,
                icon: moduleInfo.icon,
                color: moduleInfo.color,
                description: moduleInfo.description,
              };
            })
            .filter(Boolean);

          // Deduplicate by label (multiple sub-routes map to same module)
          const seen = new Set<string>();
          const deduped = usageTools.filter((t: DefaultTool) => {
            if (seen.has(t.label)) return false;
            seen.add(t.label);
            return true;
          });

          // Fill remaining slots with role defaults
          const roleDefaults = data.data.roleDefaults ?? ROLE_DEFAULT_TOOLS[userRole] ?? [];
          for (const rd of roleDefaults) {
            if (deduped.length >= MAX_TOOLS) break;
            if (!seen.has(rd.label)) {
              deduped.push(rd);
              seen.add(rd.label);
            }
          }

          setTools(deduped.slice(0, MAX_TOOLS));
          setSource('usage');
        } else {
          // Use role defaults
          const defaults = data.data?.tools ?? ROLE_DEFAULT_TOOLS[userRole] ?? [];
          setTools(defaults.slice(0, MAX_TOOLS));
          setSource('role_defaults');
        }
      } catch (error) {
        log.error('Failed to load dynamic tools', { error });
        // Fallback to role defaults from config
        const defaults = ROLE_DEFAULT_TOOLS[userRole] ?? [];
        setTools(defaults.slice(0, MAX_TOOLS));
        setSource('role_defaults');
      } finally {
        setLoading(false);
      }
    }

    fetchTools();
  }, [currentUser]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--ff-text-tertiary)]" />
        <span className="text-sm text-[var(--ff-text-tertiary)]">Loading tools...</span>
      </div>
    );
  }

  if (tools.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm text-[var(--ff-text-tertiary)]">Tools</h3>
        {source === 'usage' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-400">
            Based on your usage
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {tools.map((tool) => {
          const Icon = ICON_MAP[tool.icon] || FolderOpen;
          return (
            <Link
              key={tool.route}
              href={tool.route}
              className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:border-primary-500/50 hover:bg-[var(--ff-bg-tertiary)] transition-all duration-200"
              title={tool.description}
            >
              <Icon className={`w-4 h-4 ${tool.color}`} />
              <span className="text-sm font-medium text-[var(--ff-text-primary)] group-hover:text-primary-400 transition-colors">
                {tool.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
