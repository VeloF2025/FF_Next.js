/**
 * User Menu Dropdown Component
 */

import { User, Settings, HelpCircle, LogOut, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { UserMenuDropdownProps } from './HeaderTypes';

export function UserMenuDropdown({
  user,
  showUserMenu,
  onToggleUserMenu,
  userMenuRef,
  onLogout
}: UserMenuDropdownProps) {
  const router = useRouter();
  const { currentUser } = useAuth();

  const getUserInitials = () => {
    const userToUse = user || currentUser;
    if (userToUse?.displayName) {
      return userToUse.displayName
        .split(' ')
        .map(name => name[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (userToUse?.email) {
      return userToUse.email.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  const getUserName = () => {
    const userToUse = user || currentUser;
    return userToUse?.displayName || userToUse?.email || 'User';
  };

  const getUserRole = () => {
    const userToUse = user || currentUser;
    return userToUse?.role?.replace('_', ' ').toUpperCase() || 'USER';
  };

  const handleMenuItemClick = (path: string) => {
    router.push(path);
    onToggleUserMenu();
  };

  return (
    <div className="relative" ref={userMenuRef}>
      <button
        onClick={onToggleUserMenu}
        className="flex items-center space-x-2 p-2 hover:bg-[var(--ff-surface-secondary)] rounded-lg transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center">
          <span className="text-white text-sm font-semibold">
            {getUserInitials()}
          </span>
        </div>
        <div className="hidden lg:block text-left">
          <p className="text-sm font-medium text-[var(--ff-text-primary)]">{getUserName()}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)]">{getUserRole()}</p>
        </div>
      </button>

      {showUserMenu && (
        <div className="absolute right-0 mt-2 w-56 bg-[var(--ff-surface-elevated)] rounded-lg shadow-xl border border-[var(--ff-border-primary)] py-2 z-50">
          {/* User info */}
          <div className="px-4 py-3 border-b border-[var(--ff-border-secondary)]">
            <p className="font-medium text-[var(--ff-text-primary)]">{getUserName()}</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">{(user || currentUser)?.email}</p>
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-500/20 text-blue-400 mt-2">
              <Shield className="h-3 w-3 mr-1" />
              {getUserRole()}
            </span>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <button
              onClick={() => handleMenuItemClick('/profile')}
              className="flex items-center px-4 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] w-full text-left"
            >
              <User className="h-4 w-4 mr-3" />
              My Profile
            </button>

            <button
              onClick={() => handleMenuItemClick('/admin/settings')}
              className="flex items-center px-4 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] w-full text-left"
            >
              <Settings className="h-4 w-4 mr-3" />
              Settings
            </button>

            <button
              onClick={() => handleMenuItemClick('/help')}
              className="flex items-center px-4 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] w-full text-left"
            >
              <HelpCircle className="h-4 w-4 mr-3" />
              Help & Support
            </button>
          </div>

          <hr className="my-1 border-[var(--ff-border-secondary)]" />
          
          <button
            onClick={onLogout}
            className="flex items-center px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 w-full text-left"
          >
            <LogOut className="h-4 w-4 mr-3" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}