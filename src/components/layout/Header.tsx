import { RefreshCw, MoreHorizontal } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { HeaderProps, Notification } from './header/HeaderTypes';
import { BreadcrumbNavigation } from './header/BreadcrumbNavigation';
import { SearchBar } from './header/SearchBar';
import { NotificationsDropdown } from './header/NotificationsDropdown';
import { UserMenuDropdown } from './header/UserMenuDropdown';
import { PinButton } from './header/PinButton';
import { useAuth } from '@/contexts/AuthContext';
import { log } from '@/lib/logger';
import { formatDisplayDate } from '@/utils/dateFormat';
import {
  useUnreadCount,
  useNotificationList,
  useMarkAsRead,
  useMarkAllAsRead,
} from '@/modules/notifications/hooks';

/** Format relative time from ISO string */
function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  return formatDisplayDate(isoDate);
}

export function Header({
  title = 'Dashboard',
  breadcrumbs = ['Home'],
  actions,
  showSearch = true,
  onMenuClick,
  user
}: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const { signOut } = useAuth();

  // Real notification data
  const { data: unreadCount = 0 } = useUnreadCount();
  const { data: rawNotifications = [], isLoading } = useNotificationList(20);
  const markAsReadMutation = useMarkAsRead();
  const markAllAsReadMutation = useMarkAllAsRead();

  // Transform raw DB rows to Notification UI type
  const notifications: Notification[] = useMemo(
    () =>
      rawNotifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        time: formatRelativeTime(n.created_at),
        unread: !n.is_read,
        severity: n.severity,
        action_url: n.action_url,
        source_module: n.source_module,
        icon: n.icon,
      })),
    [rawNotifications]
  );

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      log.error('Logout failed', error instanceof Error ? { message: error.message } : {}, 'Header');
    }
  };

  return (
    <header className="bg-[var(--ff-surface-primary)] border-b border-[var(--ff-border-primary)] shadow-sm" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="px-4 lg:px-6 py-4">
        <div className="flex items-center justify-between">
          <BreadcrumbNavigation
            breadcrumbs={breadcrumbs}
            title={title}
            {...(onMenuClick && { onMenuClick })}
          />

          {/* Center - Actions (desktop) */}
          {actions && (
            <div className="hidden lg:flex items-center space-x-2 mx-4">
              {actions}
            </div>
          )}

          {/* Mobile actions overflow menu */}
          {actions && (
            <div className="relative lg:hidden mx-2">
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] rounded-lg transition-colors"
                aria-label="More actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {showMobileMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMobileMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--ff-surface-primary)] border border-[var(--ff-border-primary)] rounded-lg shadow-lg py-1 min-w-[180px] flex flex-col">
                    {actions}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Right side - Search + Theme + Notifications + User */}
          <div className="flex items-center gap-1 sm:gap-2 lg:space-x-3">
            {showSearch && (
              <SearchBar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            )}

            <ThemeToggle variant="compact" showLabel={false} />

            {/* Pin current view to dashboard */}
            <PinButton />

            {/* Sync/Refresh button */}
            <button
              className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] rounded-lg transition-colors"
              title="Sync data"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            <NotificationsDropdown
              notifications={notifications}
              showNotifications={showNotifications}
              onToggleNotifications={() => setShowNotifications(!showNotifications)}
              notificationRef={notificationRef}
              unreadCount={unreadCount}
              onMarkAsRead={(id) => markAsReadMutation.mutate([id])}
              onMarkAllAsRead={() => markAllAsReadMutation.mutate()}
              isLoading={isLoading}
            />

            <UserMenuDropdown
              {...(user && { user })}
              showUserMenu={showUserMenu}
              onToggleUserMenu={() => setShowUserMenu(!showUserMenu)}
              userMenuRef={userMenuRef}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
