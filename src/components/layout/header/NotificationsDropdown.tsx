/**
 * Notifications Dropdown Component
 * Wired to real notification data from Unified Notification Service.
 */

import { Bell, CheckCheck, Inbox } from 'lucide-react';
import { useRouter } from 'next/router';
import { NotificationsDropdownProps } from './HeaderTypes';

/** Severity → left border color */
const SEVERITY_COLORS: Record<string, string> = {
  info: 'border-l-blue-500',
  warning: 'border-l-amber-500',
  error: 'border-l-red-500',
  success: 'border-l-green-500',
};

/** Severity → unread background tint */
const SEVERITY_BG: Record<string, string> = {
  info: 'bg-blue-500/10',
  warning: 'bg-amber-500/10',
  error: 'bg-red-500/10',
  success: 'bg-green-500/10',
};

export function NotificationsDropdown({
  notifications,
  showNotifications,
  onToggleNotifications,
  notificationRef,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
  isLoading,
}: NotificationsDropdownProps) {
  const router = useRouter();

  const handleNotificationClick = (notification: typeof notifications[0]) => {
    // Mark as read
    if (notification.unread) {
      onMarkAsRead(notification.id);
    }
    // Navigate to action URL
    if (notification.action_url) {
      router.push(notification.action_url);
      onToggleNotifications(); // close dropdown
    }
  };

  return (
    <div className="relative" ref={notificationRef}>
      <button
        onClick={onToggleNotifications}
        className="relative p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] rounded-lg transition-colors"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-error-500 text-white text-xs rounded-full flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showNotifications && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[var(--ff-surface-elevated)] rounded-lg shadow-xl border border-[var(--ff-border-primary)] py-2 z-50">
          {/* Header */}
          <div className="px-4 py-2 border-b border-[var(--ff-border-secondary)] flex items-center justify-between">
            <h3 className="font-medium text-[var(--ff-text-primary)]">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllAsRead}
                className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 transition-colors"
                title="Mark all as read"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-8 text-center">
                <div className="animate-spin h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
                <p className="text-xs text-[var(--ff-text-tertiary)] mt-2">Loading...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Inbox className="h-8 w-8 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
                <p className="text-sm text-[var(--ff-text-tertiary)]">You&apos;re all caught up</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`w-full text-left px-4 py-3 border-l-4 hover:bg-[var(--ff-surface-secondary)] transition-colors ${
                    notification.unread
                      ? `${SEVERITY_COLORS[notification.severity] || 'border-l-blue-500'} ${SEVERITY_BG[notification.severity] || 'bg-blue-500/10'}`
                      : 'border-l-transparent'
                  }`}
                >
                  <p className={`text-sm ${notification.unread ? 'font-medium' : 'font-normal'} text-[var(--ff-text-primary)]`}>
                    {notification.title}
                  </p>
                  {notification.body && (
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5 line-clamp-2">
                      {notification.body}
                    </p>
                  )}
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{notification.time}</p>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-[var(--ff-border-secondary)]">
              <button
                onClick={() => {
                  router.push('/app/notifications');
                  onToggleNotifications();
                }}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
