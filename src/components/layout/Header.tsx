import { RefreshCw } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { HeaderProps, Notification } from './header/HeaderTypes';
import { BreadcrumbNavigation } from './header/BreadcrumbNavigation';
import { SearchBar } from './header/SearchBar';
import { NotificationsDropdown } from './header/NotificationsDropdown';
import { UserMenuDropdown } from './header/UserMenuDropdown';
import { useAuth } from '@/contexts/AuthContext';

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
  const [notifications] = useState<Notification[]>([
    { id: 1, title: 'New project assigned', time: '5 min ago', unread: true },
    { id: 2, title: 'Staff member added', time: '1 hour ago', unread: true },
    { id: 3, title: 'Report generated', time: '2 hours ago', unread: false },
  ]);
  
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const { signOut } = useAuth();

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
      // signOut redirects to /sign-in automatically
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <header className="bg-[var(--ff-surface-primary)] border-b border-[var(--ff-border-primary)] shadow-sm">
      <div className="px-4 lg:px-6 py-4">
        <div className="flex items-center justify-between">
          <BreadcrumbNavigation 
            breadcrumbs={breadcrumbs}
            title={title}
            {...(onMenuClick && { onMenuClick })}
          />

          {/* Center - Actions */}
          {actions && (
            <div className="hidden lg:flex items-center space-x-2 mx-4">
              {actions}
            </div>
          )}

          {/* Right side - Search + Theme + Notifications + User */}
          <div className="flex items-center space-x-2 lg:space-x-3">
            {showSearch && (
              <SearchBar 
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            )}

            <ThemeToggle variant="compact" showLabel={false} />

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