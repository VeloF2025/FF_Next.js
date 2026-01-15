/**
 * DashboardHeader Component - Professional dashboard header with welcome message and actions
 */

import { RefreshCw, Download, Settings } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface ActionButton {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  variant: 'primary' | 'secondary' | 'success' | 'danger';
  disabled?: boolean;
}

interface DashboardHeaderProps {
  title?: string;
  subtitle?: string;
  actions?: ActionButton[];
  onRefresh?: () => void;
  onExport?: () => void;
  showActions?: boolean;
  isRefreshing?: boolean;
}

export function DashboardHeader({ 
  title = "Dashboard",
  subtitle = "Welcome to FibreFlow",
  actions = [],
  onRefresh, 
  onExport, 
  showActions = true,
  isRefreshing = false
}: DashboardHeaderProps) {
  const { currentUser } = useAuth();

  // Fix hydration: only render time-dependent content after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const getGreeting = () => {
    if (!mounted) return 'Welcome'; // Static greeting for SSR
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getUserDisplayName = () => {
    if (!currentUser) return 'User';
    if (currentUser.displayName) return currentUser.displayName;
    if (currentUser.email) return currentUser.email.split('@')[0];
    return 'User';
  };

  return (
    <div className="ff-header">
      {/* Welcome Section */}
      <div className="ff-header-content">
        <div className="ff-header-text">
          <h1 className="ff-header-title">
            {title}
          </h1>
          <p className="ff-header-subtitle">
            {title === "Dashboard" 
              ? `${getGreeting()}, ${getUserDisplayName()}. ${subtitle}`
              : subtitle
            }
          </p>
        </div>
        
        {/* Custom Actions */}
        {actions.length > 0 && (
          <div className="ff-header-actions">
            {actions.map((action, index) => (
              <button
                key={index}
                onClick={action.onClick}
                className={`ff-button ${action.variant === 'primary' ? 'ff-button-primary' : 'ff-button-secondary'}`}
              >
                <action.icon className="w-4 h-4" />
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Legacy Action Buttons */}
      {showActions && actions.length === 0 && (
        <div className="ff-header-legacy-actions">
          {onRefresh && (
            <button onClick={onRefresh} className="ff-button ff-button-secondary" disabled={isRefreshing}>
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}

          {onExport && (
            <button onClick={onExport} className="ff-button ff-button-primary">
              <Download className="w-4 h-4" />
              Export Data
            </button>
          )}

          <button className="ff-button ff-button-secondary">
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      )}
    </div>
  );
}