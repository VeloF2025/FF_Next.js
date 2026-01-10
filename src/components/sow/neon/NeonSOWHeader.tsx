/**
 * Neon SOW Display Header with Status
 */

import { Database, CheckCircle, AlertCircle } from 'lucide-react';
import { NeonHealthData } from './NeonSOWTypes';

interface NeonSOWHeaderProps {
  neonHealth?: NeonHealthData;
}

export function NeonSOWHeader({ neonHealth }: NeonSOWHeaderProps) {
  return (
    <div className="p-6 border-b border-[var(--ff-border-light)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Database className="h-6 w-6 text-purple-600 mr-3" />
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Scope of Work Data</h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">Data from Neon PostgreSQL database</p>
          </div>
        </div>
        
        {/* Neon connection status */}
        <div className="flex items-center text-sm">
          {neonHealth?.connected ? (
            <div className="flex items-center text-green-600">
              <CheckCircle className="h-4 w-4 mr-1" />
              <span>Connected</span>
            </div>
          ) : (
            <div className="flex items-center text-red-600">
              <AlertCircle className="h-4 w-4 mr-1" />
              <span>Disconnected</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}