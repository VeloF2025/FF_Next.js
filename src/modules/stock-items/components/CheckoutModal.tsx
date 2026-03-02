/**
 * CheckoutModal - Check out a serial unit to a project/job site
 */

import { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle, Calendar, MapPin } from 'lucide-react';
import { log } from '@/lib/logger';

interface Serial {
  id: string;
  serial_number: string;
  status: string;
}

interface Project {
  id: string;
  name: string;
}

interface CheckoutModalProps {
  stockItemId: string;
  stockItemName: string;
  serials: Serial[];
  onClose: () => void;
  onSuccess: () => void;
}

export function CheckoutModal({ stockItemId, stockItemName, serials, onClose, onSuccess }: CheckoutModalProps) {
  const availableSerials = serials.filter(s => s.status === 'available');
  const [selectedSerialId, setSelectedSerialId] = useState(availableSerials[0]?.id || '');
  const [projectId, setProjectId] = useState('');
  const [jobSiteName, setJobSiteName] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch projects for picker
  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await fetch('/api/projects?limit=200');
        const data = await res.json();
        if (data.data) {
          setProjects(data.data.map((p: Record<string, unknown>) => ({ id: p.id, name: p.name })));
        }
      } catch (err) {
        log.error('Failed to fetch projects', { error: err }, 'CheckoutModal');
      }
    }
    fetchProjects();
  }, []);

  // Set default return date to 7 days from now
  useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setExpectedReturnDate(d.toISOString().split('T')[0]);
  }, []);

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedSerialId) {
      setError('Please select a serial unit');
      return;
    }
    if (!expectedReturnDate) {
      setError('Please set an expected return date');
      return;
    }
    if (!projectId && !jobSiteName) {
      setError('Please select a project or enter a job site name');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/stock/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialId: selectedSerialId,
          projectId: projectId || null,
          jobSiteName: jobSiteName || null,
          expectedReturnDate,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to check out');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check out');
    } finally {
      setIsSubmitting(false);
    }
  };

  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Check Out Tool</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--ff-bg-hover)] rounded">
            <X className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Item name */}
          <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <p className="text-xs text-[var(--ff-text-tertiary)]">Item</p>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">{stockItemName}</p>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Serial picker */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Serial Unit *
            </label>
            {availableSerials.length === 0 ? (
              <p className="text-sm text-amber-400">No available serials. Add one first.</p>
            ) : (
              <select
                value={selectedSerialId}
                onChange={(e) => setSelectedSerialId(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {availableSerials.map(s => (
                  <option key={s.id} value={s.id}>{s.serial_number}</option>
                ))}
              </select>
            )}
          </div>

          {/* Project picker */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              <MapPin className="h-3.5 w-3.5 inline mr-1" />
              Project
            </label>
            <input
              type="text"
              value={projectSearch}
              onChange={(e) => {
                setProjectSearch(e.target.value);
                if (!e.target.value) setProjectId('');
              }}
              placeholder="Search projects..."
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {projectSearch && !projectId && filteredProjects.length > 0 && (
              <div className="mt-1 max-h-32 overflow-y-auto bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                {filteredProjects.slice(0, 8).map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProjectId(p.id);
                      setProjectSearch(p.name);
                      setJobSiteName('');
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)]"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Job site fallback */}
          {!projectId && (
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Or Job Site Name
              </label>
              <input
                type="text"
                value={jobSiteName}
                onChange={(e) => setJobSiteName(e.target.value)}
                placeholder="Enter job site name"
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Return date */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              <Calendar className="h-3.5 w-3.5 inline mr-1" />
              Expected Return Date *
            </label>
            <input
              type="date"
              value={expectedReturnDate}
              onChange={(e) => setExpectedReturnDate(e.target.value)}
              min={minDate.toISOString().split('T')[0]}
              required
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || availableSerials.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Check Out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
