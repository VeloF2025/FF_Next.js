import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { OfflineData } from '../types/field-app.types';

interface OfflineStatusProps {
  isOffline: boolean;
  offlineData: OfflineData;
  onSync: () => void;
  isSyncing: boolean;
}

export function OfflineStatus({ 
  isOffline, 
  offlineData, 
  onSync, 
  isSyncing 
}: OfflineStatusProps) {
  return (
    <div className={cn(
      "rounded-lg p-4 border",
      isOffline ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200"
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          {isOffline ? (
            <CloudOff className="w-5 h-5 text-orange-600" />
          ) : (
            <Cloud className="w-5 h-5 text-green-600" />
          )}
          <span className={cn(
            "font-medium",
            isOffline ? "text-orange-800" : "text-green-800"
          )}>
            {isOffline ? 'Offline Mode' : 'Online'}
          </span>
        </div>
        
        <button
          onClick={onSync}
          disabled={isSyncing}
          className={cn(
            "flex items-center space-x-1 px-3 py-1 rounded-md text-sm font-medium",
            isOffline 
              ? "bg-orange-100 text-orange-700 hover:bg-orange-200" 
              : "bg-green-100 text-green-700 hover:bg-green-200",
            isSyncing && "opacity-50 cursor-not-allowed"
          )}
        >
          <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
          <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
        </button>
      </div>

      {isOffline && (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-[var(--ff-text-secondary)]">Tasks:</span>
              <span className="font-medium">{offlineData.tasks}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ff-text-secondary)]">Photos:</span>
              <span className="font-medium">{offlineData.photos}</span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-[var(--ff-text-secondary)]">Forms:</span>
              <span className="font-medium">{offlineData.forms}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ff-text-secondary)]">Size:</span>
              <span className="font-medium">{offlineData.dataSize}</span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-2 text-xs text-[var(--ff-text-tertiary)]">
        Last sync: {offlineData.lastSync}
      </div>
    </div>
  );
}