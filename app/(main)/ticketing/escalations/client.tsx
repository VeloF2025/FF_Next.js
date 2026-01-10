'use client';

/**
 * Escalation Management Page Client Component
 *
 * Manages repeat fault escalations and infrastructure-level issues:
 * - Active escalations (pole, PON, zone, DR-level)
 * - Repeat fault patterns and detection
 * - Infrastructure ticket creation
 * - Escalation resolution tracking
 * - Fault trend visualization
 *
 * 🟢 WORKING: Escalation management page integrates escalation components
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { EscalationList } from '@/modules/ticketing/components/Escalation/EscalationList';
import { EscalationAlert } from '@/modules/ticketing/components/Escalation/EscalationAlert';
import { RepeatFaultMap } from '@/modules/ticketing/components/Escalation/RepeatFaultMap';
import type { RepeatFaultEscalation, RepeatFaultAlert } from '@/modules/ticketing/types/escalation';

export default function EscalationsPageClient() {
  const [activeView, setActiveView] = useState<'list' | 'map'>('list');
  const [escalations, setEscalations] = useState<RepeatFaultEscalation[]>([]);
  const [alerts, setAlerts] = useState<RepeatFaultAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch escalations on mount
  useEffect(() => {
    async function fetchEscalations() {
      try {
        setIsLoading(true);
        const response = await fetch('/api/ticketing/escalations');
        if (!response.ok) {
          throw new Error('Failed to fetch escalations');
        }
        const result = await response.json();
        if (result.success) {
          setEscalations(result.data || []);
          // Create alerts from open escalations
          const openEscalations = (result.data || []).filter(
            (e: RepeatFaultEscalation) => e.status === 'open'
          );
          const escalationAlerts: RepeatFaultAlert[] = openEscalations.slice(0, 3).map(
            (e: RepeatFaultEscalation) => ({
              escalation_id: e.id,
              severity: e.fault_count >= 5 ? 'critical' : e.fault_count >= 3 ? 'high' : 'medium',
              scope_type: e.scope_type,
              scope_value: e.scope_value,
              fault_count: e.fault_count,
              message: `Repeat faults detected on ${e.scope_type} ${e.scope_value}`,
              recommended_action: `Investigate ${e.scope_type} for potential infrastructure issues`,
              created_at: e.created_at,
            })
          );
          setAlerts(escalationAlerts);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load escalations');
      } finally {
        setIsLoading(false);
      }
    }

    fetchEscalations();
  }, []);

  const handleDismissAlert = (escalationId: string) => {
    setAlerts(prev => prev.filter(a => a.escalation_id !== escalationId));
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Escalation Management</h1>
        <p className="text-[var(--ff-text-secondary)]">
          Track and resolve repeat faults and infrastructure-level issues
        </p>
      </div>

      {/* Escalation Alerts - High priority warnings */}
      {alerts.length > 0 && (
        <div className="mb-6 space-y-3">
          {alerts.map((alert) => (
            <EscalationAlert
              key={alert.escalation_id}
              alert={alert}
              onDismiss={handleDismissAlert}
              dismissible
            />
          ))}
        </div>
      )}

      {/* View Toggle */}
      <div className="mb-6 flex gap-4">
        <button
          onClick={() => setActiveView('list')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeView === 'list'
              ? 'bg-blue-600 text-white'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
          }`}
        >
          Escalation List
        </button>
        <button
          onClick={() => setActiveView('map')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeView === 'map'
              ? 'bg-blue-600 text-white'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
          }`}
        >
          Fault Map
        </button>
      </div>

      {/* Content Area */}
      {activeView === 'list' ? (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <EscalationList
            escalations={escalations}
            isLoading={isLoading}
            error={error}
            showFilters
          />
        </div>
      ) : (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">Repeat Fault Patterns</h2>
          <RepeatFaultMap />
        </div>
      )}
    </div>
  );
}
