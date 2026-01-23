import { LucideIcon } from 'lucide-react';
import { Permission } from '@/types/auth.types';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  permissions: Permission[];  // Legacy permission enum (deprecated, use rbacKey)
  rbacKey?: string;           // RBAC permission key like 'dashboard', 'projects', 'procurement.sourcing'
  subItems?: NavItem[];
  external?: boolean; // Opens in new tab
  isGroup?: boolean; // If true, this is a collapsible group header (not navigable)
}

export interface NavSection {
  section: string;
  sectionId: string;
  items: NavItem[];
  isCollapsible?: boolean;
  defaultExpanded?: boolean;
}

export interface SidebarProps {
  isOpen: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  onCollapse: () => void;
}

export interface SidebarStyles {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  textColorSecondary: string;
  textColorTertiary: string;
}