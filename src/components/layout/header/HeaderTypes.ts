/**
 * Header component types and interfaces
 */

import { User as UserType } from '@/types/auth.types';
import type { NotificationSeverity } from '@/modules/notifications/types';

export interface HeaderProps {
  title?: string;
  breadcrumbs?: string[];
  actions?: React.ReactNode;
  showSearch?: boolean;
  onMenuClick?: () => void;
  user?: UserType | null;
}

export interface Notification {
  id: string;
  title: string;
  body: string | null;
  time: string;
  unread: boolean;
  severity: NotificationSeverity;
  action_url: string | null;
  source_module: string | null;
  icon: string;
}

export interface BreadcrumbsProps {
  breadcrumbs: string[];
  title: string;
  onMenuClick?: () => void;
}

export interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export interface NotificationsDropdownProps {
  notifications: Notification[];
  showNotifications: boolean;
  onToggleNotifications: () => void;
  notificationRef: React.RefObject<HTMLDivElement>;
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  isLoading?: boolean;
}

export interface UserMenuDropdownProps {
  user?: UserType | null;
  currentUser?: UserType | null;
  showUserMenu: boolean;
  onToggleUserMenu: () => void;
  userMenuRef: React.RefObject<HTMLDivElement>;
  onLogout: () => void;
}
