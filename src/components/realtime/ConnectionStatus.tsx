/**
 * WebSocket Connection Status Indicator
 * Shows real-time connection status in the UI
 */

import React, { useState, useEffect } from 'react';
import { socketIOAdapter } from '@/services/realtime/socketIOAdapter';
import { pollingAdapter } from '@/services/realtime/pollingAdapter';
import { Wifi, WifiOff, RefreshCw, AlertCircle } from 'lucide-react';

export interface ConnectionStatusProps {
  mode?: 'websocket' | 'polling' | 'auto';
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  showDetails?: boolean;
  autoHide?: boolean;
  autoHideDelay?: number;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  mode = 'auto',
  position = 'bottom-right',
  showDetails = false,
  autoHide = true,
  autoHideDelay = 5000
}) => {
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting' | 'error'>('disconnected');
  const [connectionMode, setConnectionMode] = useState<'websocket' | 'polling' | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [hideTimer, setHideTimer] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let adapter = mode === 'polling' ? pollingAdapter : socketIOAdapter;
    
    // Try WebSocket first, fallback to polling if auto mode
    if (mode === 'auto') {
      adapter = socketIOAdapter;
    }

    const handleConnected = () => {
      setStatus('connected');
      setConnectionMode(adapter === socketIOAdapter ? 'websocket' : 'polling');
      setLastUpdate(new Date());
      
      // Auto-hide after connection if enabled
      if (autoHide && status !== 'connected') {
        const timer = setTimeout(() => {
          setIsVisible(false);
        }, autoHideDelay);
        setHideTimer(timer);
      }
    };

    const handleDisconnected = () => {
      setStatus('disconnected');
      setIsVisible(true);
      if (hideTimer) {
        clearTimeout(hideTimer);
        setHideTimer(null);
      }
    };

    const handleError = () => {
      setStatus('error');
      setIsVisible(true);
      if (hideTimer) {
        clearTimeout(hideTimer);
        setHideTimer(null);
      }
      
      // If WebSocket fails in auto mode, try polling
      if (mode === 'auto' && adapter === socketIOAdapter) {
        console.log('WebSocket failed, switching to polling mode');
        adapter = pollingAdapter;
        pollingAdapter.start();
        setConnectionMode('polling');
      }
    };

    const handleEvent = () => {
      setLastUpdate(new Date());
    };

    // Set up event listeners
    adapter.on('connected', handleConnected);
    adapter.on('disconnected', handleDisconnected);
    adapter.on('error', handleError);
    adapter.on('event', handleEvent);

    // Check initial connection status
    if (adapter === socketIOAdapter && socketIOAdapter.isConnected()) {
      handleConnected();
    } else if (adapter === pollingAdapter && pollingAdapter.isActive()) {
      handleConnected();
    } else {
      setStatus('connecting');
      // Attempt connection
      if (adapter === socketIOAdapter) {
        socketIOAdapter.connect().catch(() => {
          if (mode === 'auto') {
            // Fallback to polling
            pollingAdapter.start();
            setConnectionMode('polling');
          }
        });
      } else {
        pollingAdapter.start();
      }
    }

    // Cleanup
    return () => {
      adapter.off('connected', handleConnected);
      adapter.off('disconnected', handleDisconnected);
      adapter.off('error', handleError);
      adapter.off('event', handleEvent);
      
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
    };
  }, [mode, autoHide, autoHideDelay, status]);

  // Position classes
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4'
  };

  // Status colors and icons
  const statusConfig = {
    connected: {
      icon: Wifi,
      color: 'text-green-400',
      bgColor: 'bg-green-500/20',
      borderColor: 'border-green-500/30',
      label: 'Connected'
    },
    disconnected: {
      icon: WifiOff,
      color: 'text-red-400',
      bgColor: 'bg-red-500/20',
      borderColor: 'border-red-500/30',
      label: 'Disconnected'
    },
    connecting: {
      icon: RefreshCw,
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      borderColor: 'border-yellow-500/30',
      label: 'Connecting...',
      animate: true
    },
    error: {
      icon: AlertCircle,
      color: 'text-orange-400',
      bgColor: 'bg-orange-500/20',
      borderColor: 'border-orange-500/30',
      label: 'Connection Error'
    }
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  // Don't render if hidden
  if (!isVisible && autoHide) {
    return null;
  }

  return (
    <div
      className={`fixed ${positionClasses[position]} z-50 transition-all duration-300 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${config.bgColor} ${config.borderColor} shadow-sm`}
        onMouseEnter={() => {
          if (hideTimer) {
            clearTimeout(hideTimer);
            setHideTimer(null);
          }
          setIsVisible(true);
        }}
      >
        <Icon
          className={`w-4 h-4 ${config.color} ${
            config.animate ? 'animate-spin' : ''
          }`}
        />
        
        <div className="flex flex-col">
          <span className={`text-sm font-medium ${config.color}`}>
            {config.label}
          </span>
          
          {showDetails && (
            <div className="text-xs text-[var(--ff-text-secondary)] mt-0.5">
              {connectionMode && (
                <span className="capitalize">{connectionMode}</span>
              )}
              {lastUpdate && (
                <span className="ml-2">
                  Last update: {lastUpdate.toLocaleTimeString()}
                </span>
              )}
            </div>
          )}
        </div>

        {status === 'disconnected' && (
          <button
            onClick={() => {
              setStatus('connecting');
              if (connectionMode === 'polling') {
                pollingAdapter.start();
              } else {
                socketIOAdapter.connect();
              }
            }}
            className="ml-2 text-xs text-blue-400 hover:text-blue-500 underline"
          >
            Reconnect
          </button>
        )}
      </div>
    </div>
  );
};

// Hook for using connection status in other components
export const useConnectionStatus = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [mode, setMode] = useState<'websocket' | 'polling' | null>(null);

  useEffect(() => {
    const checkConnection = () => {
      if (socketIOAdapter.isConnected()) {
        setIsConnected(true);
        setMode('websocket');
      } else if (pollingAdapter.isActive()) {
        setIsConnected(true);
        setMode('polling');
      } else {
        setIsConnected(false);
        setMode(null);
      }
    };

    // Check initially
    checkConnection();

    // Listen for changes
    const handleChange = () => checkConnection();
    
    socketIOAdapter.on('connected', handleChange);
    socketIOAdapter.on('disconnected', handleChange);
    pollingAdapter.on('connected', handleChange);
    pollingAdapter.on('disconnected', handleChange);

    return () => {
      socketIOAdapter.off('connected', handleChange);
      socketIOAdapter.off('disconnected', handleChange);
      pollingAdapter.off('connected', handleChange);
      pollingAdapter.off('disconnected', handleChange);
    };
  }, []);

  return { isConnected, mode };
};