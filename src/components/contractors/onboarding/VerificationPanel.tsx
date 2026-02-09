/**
 * VerificationPanel - Company verification wizard for onboarding Stage 2
 * Manages director entry, bundle selection, and verification execution
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Shield, Loader2, DollarSign, Users, Building2, UserCheck, Info, Star } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { validateSaId } from '@/lib/saIdValidation';
import { VerificationCheckRow } from './VerificationCheckRow';
import { log } from '@/lib/logger';
import type {
  ContractorDirector,
  VerificationBundle,
  VerifyContractorResponse,
  VerificationType,
  DirectorRole,
} from '@/types/contractor-verification.types';
import {
  estimateBundleCost,
  formatCostRands,
  VERIFICATION_COSTS,
  BUNDLE_CHECKS,
} from '@/lib/verificationCosts';

interface VerificationPanelProps {
  contractorId: string;
  onVerificationComplete: (passed: boolean) => void;
}

interface DirectorForm {
  fullName: string;
  idNumber: string;
  role: DirectorRole;
  isPrimary: boolean;
  idValidation: { isValid: boolean; dob: string | null; gender: string | null } | null;
}

const CHECK_LABELS: Record<string, string> = {
  cipc_company: 'CIPC Company',
  id_verification: 'ID Verification',
  id_photo: 'ID Photo (DHA)',
  criminal_record: 'Criminal Record',
  pep_sanctions: 'PEP & Sanctions',
  qualification: 'Qualification',
  drivers_license: "Driver's License",
  adverse_news: 'Adverse News',
};

const BUNDLE_OPTIONS: { value: VerificationBundle; label: string; description: string; recommended?: boolean }[] = [
  { value: 'basic', label: 'Basic', description: 'CIPC company lookup only' },
  { value: 'standard', label: 'Standard', description: 'Company + ID verification + PEP/sanctions per director', recommended: true },
  { value: 'enhanced', label: 'Enhanced', description: 'Standard + ID photo + criminal record check' },
  { value: 'full_due_diligence', label: 'Full Due Diligence', description: 'All available checks' },
];

export function VerificationPanel({ contractorId, onVerificationComplete }: VerificationPanelProps) {
  const [directors, setDirectors] = useState<ContractorDirector[]>([]);
  const [newDirector, setNewDirector] = useState<DirectorForm>({
    fullName: '', idNumber: '', role: 'director', isPrimary: false, idValidation: null,
  });
  const [selectedBundle, setSelectedBundle] = useState<VerificationBundle>('standard');
  const [results, setResults] = useState<VerifyContractorResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isAddingDirector, setIsAddingDirector] = useState(false);
  const [showCostConfirm, setShowCostConfirm] = useState(false);
  const [runningCheck, setRunningCheck] = useState<string | null>(null);

  // Load existing data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [directorsRes, verifyRes] = await Promise.all([
        fetch(`/api/contractors-directors?contractorId=${contractorId}`),
        fetch(`/api/contractors-verify?contractorId=${contractorId}`),
      ]);

      if (directorsRes.ok) {
        const d = await directorsRes.json();
        setDirectors(d.data || []);
      }
      if (verifyRes.ok) {
        const v = await verifyRes.json();
        setResults(v.data || null);
        if (v.data?.overallStatus === 'passed') {
          onVerificationComplete(true);
        }
      }
    } catch (err) {
      log.error('Failed to load verification data', { error: err }, 'VerificationPanel');
    } finally {
      setIsLoading(false);
    }
  }, [contractorId, onVerificationComplete]);

  // Load on mount
  useEffect(() => {
    loadData();
  }, [contractorId, loadData]);

  // Inline SA ID validation
  const handleIdChange = (value: string) => {
    const cleaned = value.replace(/\s/g, '');
    let idValidation = null;
    if (cleaned.length === 13) {
      const result = validateSaId(cleaned);
      idValidation = { isValid: result.isValid, dob: result.dateOfBirth, gender: result.gender };
    }
    setNewDirector(prev => ({ ...prev, idNumber: cleaned, idValidation }));
  };

  const handleAddDirector = async () => {
    if (!newDirector.fullName.trim() || !newDirector.idNumber.trim()) {
      notificationService.warning('Full name and ID number are required');
      return;
    }

    setIsAddingDirector(true);
    try {
      const res = await fetch('/api/contractors-directors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractorId,
          fullName: newDirector.fullName.trim(),
          idNumber: newDirector.idNumber.trim(),
          role: newDirector.role,
          isPrimary: newDirector.isPrimary,
        }),
      });

      if (res.ok) {
        setNewDirector({ fullName: '', idNumber: '', role: 'director', isPrimary: false, idValidation: null });
        await loadData();
        notificationService.success('Director added');
      } else {
        const err = await res.json();
        notificationService.error(err.error?.message || 'Failed to add director');
      }
    } catch {
      notificationService.error('Failed to add director');
    } finally {
      setIsAddingDirector(false);
    }
  };

  const handleRemoveDirector = async (id: string) => {
    try {
      const res = await fetch(`/api/contractors-directors?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadData();
        notificationService.success('Director removed');
      }
    } catch {
      notificationService.error('Failed to remove director');
    }
  };

  const handleRunVerification = async () => {
    setShowCostConfirm(false);
    setIsVerifying(true);
    try {
      const res = await fetch('/api/contractors-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId, bundle: selectedBundle }),
      });

      if (res.ok) {
        const data = await res.json();
        setResults(data.data);
        if (data.data?.overallStatus === 'passed') {
          onVerificationComplete(true);
          notificationService.success('Company verification passed');
        } else if (data.data?.overallStatus === 'warning') {
          notificationService.warning('Verification completed with warnings');
        } else if (data.data?.overallStatus === 'failed') {
          notificationService.error('Verification failed - see details below');
        }
      } else {
        const err = await res.json();
        notificationService.error(err.error?.message || 'Verification failed');
      }
    } catch {
      notificationService.error('Verification request failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRunIndividualCheck = async (directorId: string, checkType: VerificationType) => {
    setRunningCheck(`${directorId}-${checkType}`);
    try {
      const res = await fetch('/api/contractors-verify-individual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId, directorId, checkType }),
      });

      if (res.ok) {
        await loadData();
        notificationService.success('Check completed');
      } else {
        const err = await res.json();
        notificationService.error(err.error?.message || 'Check failed');
      }
    } catch {
      notificationService.error('Check request failed');
    } finally {
      setRunningCheck(null);
    }
  };

  const directorCount = Math.max(directors.length, 1);
  const estimatedCost = estimateBundleCost(selectedBundle, directorCount);
  const bundleChecks = BUNDLE_CHECKS[selectedBundle];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">Loading verification data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Section 1: Directors/Staff Entry */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-blue-400" />
          <h5 className="text-sm font-semibold text-[var(--ff-text-primary)]">Directors & Key Staff</h5>
          {directors.length > 0 && (
            <span className="text-xs text-[var(--ff-text-tertiary)]">({directors.length} added)</span>
          )}
        </div>

        {/* Existing directors */}
        {directors.length > 0 ? (
          <div className="space-y-2 mb-3">
            {directors.map(dir => (
              <div key={dir.id} className="flex items-center justify-between py-2 px-3 bg-[var(--ff-bg-tertiary)] rounded text-sm">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {dir.isPrimary && <Star className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-[var(--ff-text-primary)]">{dir.fullName}</span>
                    <span className="text-[var(--ff-text-tertiary)] ml-2 font-mono text-xs">{dir.idNumber}</span>
                    <span className="ml-2 text-xs text-[var(--ff-text-tertiary)] capitalize">{dir.role.replace('_', ' ')}</span>
                    {dir.isPrimary && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">Primary</span>
                    )}
                    {dir.idValid === true && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">ID Valid</span>
                    )}
                    {dir.idValid === false && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">ID Invalid</span>
                    )}
                    {dir.cipcMatched === true && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">CIPC Match</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveDirector(dir.id)}
                  className="ml-2 p-1 text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors"
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-3 py-3 px-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-blue-300">
                Add at least one director or key staff member to run verification.
                Their ID numbers will be validated and cross-referenced against CIPC records.
              </p>
            </div>
          </div>
        )}

        {/* Add new director form */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Full Name</label>
              <input
                type="text"
                value={newDirector.fullName}
                onChange={e => setNewDirector(prev => ({ ...prev, fullName: e.target.value }))}
                className="w-full px-3 py-1.5 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-[var(--ff-text-tertiary)]"
                placeholder="John Doe"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">SA ID Number</label>
              <input
                type="text"
                value={newDirector.idNumber}
                onChange={e => handleIdChange(e.target.value)}
                maxLength={13}
                className={`w-full px-3 py-1.5 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] border rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-[var(--ff-text-tertiary)] ${
                  newDirector.idValidation
                    ? newDirector.idValidation.isValid ? 'border-green-500/50 bg-green-500/10' : 'border-red-500/50 bg-red-500/10'
                    : 'border-[var(--ff-border-light)]'
                }`}
                placeholder="8501015800085"
              />
              {newDirector.idValidation && (
                <p className={`text-xs mt-0.5 ${newDirector.idValidation.isValid ? 'text-green-400' : 'text-red-400'}`}>
                  {newDirector.idValidation.isValid
                    ? `${newDirector.idValidation.gender} | DOB: ${newDirector.idValidation.dob}`
                    : 'Invalid ID number'}
                </p>
              )}
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Role</label>
              <select
                value={newDirector.role}
                onChange={e => setNewDirector(prev => ({ ...prev, role: e.target.value as DirectorRole }))}
                className="w-full px-3 py-1.5 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="director">Director</option>
                <option value="staff">Staff</option>
                <option value="key_person">Key Person</option>
              </select>
            </div>
            <button
              onClick={handleAddDirector}
              disabled={isAddingDirector || !newDirector.fullName || !newDirector.idNumber}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isAddingDirector ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </button>
          </div>
          {/* Primary toggle */}
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newDirector.isPrimary}
              onChange={e => setNewDirector(prev => ({ ...prev, isPrimary: e.target.checked }))}
              className="h-3.5 w-3.5 rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-[var(--ff-text-secondary)]">Primary contact person</span>
          </label>
        </div>
      </div>

      {/* Section 2: Bundle Selector */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-4 w-4 text-blue-400" />
          <h5 className="text-sm font-semibold text-[var(--ff-text-primary)]">Verification Bundle</h5>
        </div>
        <div className="space-y-1.5">
          {BUNDLE_OPTIONS.map(opt => {
            const checks = BUNDLE_CHECKS[opt.value];
            const isSelected = selectedBundle === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer border transition-colors ${
                  isSelected
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] hover:border-[var(--ff-border-medium)]'
                }`}
              >
                <input
                  type="radio"
                  name="bundle"
                  value={opt.value}
                  checked={isSelected}
                  onChange={() => setSelectedBundle(opt.value)}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--ff-text-primary)]">{opt.label}</span>
                    {opt.recommended && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/20 text-blue-400 rounded-full uppercase tracking-wide">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{opt.description}</p>
                  {isSelected && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {checks.map(check => (
                        <span key={check} className="px-1.5 py-0.5 text-[10px] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded">
                          {CHECK_LABELS[check] || check}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-sm font-mono font-semibold text-[var(--ff-text-primary)] whitespace-nowrap">
                  {formatCostRands(estimateBundleCost(opt.value, directorCount))}
                </span>
              </label>
            );
          })}
        </div>
        {directors.length > 1 && (
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-2 flex items-center gap-1">
            <Info className="h-3 w-3" />
            Per-person checks multiply by {directors.length} directors/staff
          </p>
        )}
      </div>

      {/* Section 3: Run Verification */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowCostConfirm(true)}
          disabled={isVerifying || directors.length === 0}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            directors.length === 0
              ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {isVerifying ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Verifying...</>
          ) : (
            <><Shield className="h-4 w-4" /> Run Verification</>
          )}
        </button>
        <span className="text-sm text-[var(--ff-text-secondary)]">
          {directors.length === 0 ? (
            <span className="text-amber-400 italic">Add directors first</span>
          ) : (
            <>
              Estimated cost: <span className="font-semibold text-[var(--ff-text-primary)]">{formatCostRands(estimatedCost)}</span>
              {' '}for {directors.length} {directors.length === 1 ? 'person' : 'people'}
            </>
          )}
        </span>
      </div>

      {/* Cost Confirmation Modal */}
      {showCostConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg max-w-sm w-full p-5 shadow-xl border border-[var(--ff-border-light)]">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="h-5 w-5 text-amber-400" />
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Confirm Verification Cost</h3>
            </div>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-3">
              Running <span className="font-semibold text-[var(--ff-text-primary)]">{selectedBundle}</span> verification for{' '}
              <span className="font-semibold text-[var(--ff-text-primary)]">{directors.length}</span> {directors.length === 1 ? 'person' : 'people'}:
            </p>
            <div className="mb-3 space-y-1">
              {bundleChecks.map(check => (
                <div key={check} className="flex justify-between text-xs text-[var(--ff-text-secondary)]">
                  <span>{CHECK_LABELS[check] || check}</span>
                  <span className="font-mono">
                    {formatCostRands(VERIFICATION_COSTS[check])}
                    {check !== 'cipc_company' && directors.length > 1 ? ` x${directors.length}` : ''}
                  </span>
                </div>
              ))}
              <div className="border-t border-[var(--ff-border-light)] pt-1 mt-1 flex justify-between text-sm font-semibold text-[var(--ff-text-primary)]">
                <span>Total</span>
                <span>{formatCostRands(estimatedCost)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRunVerification}
                className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
              >
                Confirm & Run
              </button>
              <button
                onClick={() => setShowCostConfirm(false)}
                className="flex-1 px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] text-sm rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Section 4: Results */}
      {results && results.companyVerification.status !== 'pending' && (
        <div className="space-y-4">
          {/* Company Status Card */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="h-4 w-4 text-blue-400" />
              <h5 className="text-sm font-semibold text-[var(--ff-text-primary)]">Company Verification</h5>
              <StatusBadge status={results.companyVerification.status} />
            </div>

            {results.companyVerification.companyResult && (
              <div className="mb-3 p-3 bg-[var(--ff-bg-tertiary)] rounded-lg text-sm space-y-1">
                <p><span className="text-[var(--ff-text-tertiary)] w-16 inline-block">Name:</span> <span className="font-medium text-[var(--ff-text-primary)]">{results.companyVerification.companyResult.companyName}</span></p>
                <p><span className="text-[var(--ff-text-tertiary)] w-16 inline-block">Reg:</span> <span className="font-mono text-[var(--ff-text-primary)]">{results.companyVerification.companyResult.registrationNumber}</span></p>
                <p><span className="text-[var(--ff-text-tertiary)] w-16 inline-block">Type:</span> <span className="text-[var(--ff-text-primary)]">{results.companyVerification.companyResult.companyType}</span></p>
                <p>
                  <span className="text-[var(--ff-text-tertiary)] w-16 inline-block">Status:</span>{' '}
                  <span className={`font-semibold ${results.companyVerification.companyResult.status === 'IN BUSINESS' ? 'text-green-400' : 'text-red-400'}`}>
                    {results.companyVerification.companyResult.status}
                  </span>
                </p>
              </div>
            )}

            <div className="space-y-1">
              {results.companyVerification.checks.map((check, idx) => (
                <VerificationCheckRow
                  key={idx}
                  label={check.field}
                  status={check.status}
                  expected={check.expected}
                  actual={check.actual}
                  message={check.message}
                />
              ))}
            </div>
          </div>

          {/* Director Matches */}
          {results.companyVerification.directorMatches.length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <UserCheck className="h-4 w-4 text-blue-400" />
                <h5 className="text-sm font-semibold text-[var(--ff-text-primary)]">Director Matching</h5>
              </div>
              <div className="space-y-2">
                {results.companyVerification.directorMatches.map((match, idx) => (
                  <div key={idx} className="flex items-center gap-2 py-1.5 px-2 text-sm rounded hover:bg-[var(--ff-bg-tertiary)]">
                    <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                      match.matchType === 'id_exact' ? 'bg-green-500/20 text-green-400' :
                      match.matchType === 'name_fuzzy' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {match.matchType === 'id_exact' ? 'ID Match' : match.matchType === 'name_fuzzy' ? 'Name Match' : 'No Match'}
                    </span>
                    <span className="font-medium text-[var(--ff-text-primary)]">{match.enteredName}</span>
                    {match.cipcMatch && (
                      <span className="text-[var(--ff-text-tertiary)]">&#8594; {match.cipcMatch.fullName} ({match.cipcMatch.status})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Individual Checks per Director */}
          {directors.length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
              <h5 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-3">Individual Checks</h5>
              {directors.map(dir => {
                const dirChecks = results.individualChecks.filter(c => c.directorId === dir.id);
                return (
                  <div key={dir.id} className="mb-3 last:mb-0">
                    <p className="text-sm font-medium text-[var(--ff-text-primary)] mb-1 flex items-center gap-1">
                      {dir.isPrimary && <Star className="h-3 w-3 text-amber-400" />}
                      {dir.fullName}
                      <span className="text-xs text-[var(--ff-text-tertiary)] font-normal capitalize ml-1">({dir.role.replace('_', ' ')})</span>
                    </p>
                    <div className="space-y-1 ml-2">
                      {dirChecks.map(check => (
                        <VerificationCheckRow
                          key={check.id}
                          label={CHECK_LABELS[check.verificationType] || check.verificationType.replace(/_/g, ' ')}
                          status={check.status}
                          message={check.status === 'passed' ? 'Clear' : check.status === 'failed' ? 'Issues found' : check.status}
                        />
                      ))}
                      {/* Show available unrun checks */}
                      {(['id_verification', 'id_photo', 'criminal_record', 'pep_sanctions'] as VerificationType[]).map(type => {
                        const existing = dirChecks.find(c => c.verificationType === type);
                        if (existing) return null;
                        return (
                          <VerificationCheckRow
                            key={type}
                            label={CHECK_LABELS[type] || type.replace(/_/g, ' ')}
                            status="pending"
                            message="Not yet run"
                            costCents={VERIFICATION_COSTS[type]}
                            onRun={
                              runningCheck === `${dir.id}-${type}` ? undefined :
                              () => handleRunIndividualCheck(dir.id, type)
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Cost Summary */}
          <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] rounded-lg p-3">
            <DollarSign className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <span>Total spent: <span className="font-semibold text-[var(--ff-text-primary)]">{formatCostRands(results.totalCostCents)}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    passed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
    warning: 'bg-amber-500/20 text-amber-400',
    pending: 'bg-gray-500/20 text-gray-400',
    error: 'bg-red-500/20 text-red-400',
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${styles[status] || styles.pending}`}>
      {status.toUpperCase()}
    </span>
  );
}
