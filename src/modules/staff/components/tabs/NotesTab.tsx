'use client';

/**
 * Staff Notes/Comments Tab
 * Displays notes, comments, and generated summaries for staff members
 * Supports contract summary generation using template prompts
 */

import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Plus,
  FileText,
  Clock,
  User,
  Sparkles,
  Copy,
  Check,
  AlertCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { formatDisplayDate, formatDisplayDateTime } from '@/utils/dateFormat';
import { log } from '@/lib/logger';
import { notificationService } from '@/services/core/NotificationService';
import type { StaffMember } from '@/types/staff';
import { formatLabel } from '@/lib/utils';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

interface ContractMetadata {
  employmentType?: string;
  companyName?: string;
  workLocation?: string;
  salary?: string;
  salaryPeriod?: string;
  signatureDate?: string;
  employeeSigned?: boolean | string;
  employerSigned?: boolean | string;
  witnessesSigned?: boolean | string;
  signatureNotes?: string;
  jobTitle?: string;
}

interface StaffNote {
  id: string;
  staffId: string;
  noteType: 'general' | 'contract_summary' | 'hr_note' | 'document_note' | 'system';
  title?: string;
  content: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, ContractMetadata | string | number | boolean | null>;
}

interface NotesTabProps {
  staff: StaffMember;
  staffId: string;
}

// Contract summary template with injectable variables
const CONTRACT_SUMMARY_TEMPLATE = `## Employment Contract Summary

**Employee:** {{employeeName}}
**ID Number:** {{saIdNumber}}
**Position:** {{position}}
**Department:** {{department}}
**Start Date:** {{startDate}}
**Employment Type:** {{employmentType}}

### Contract Details
- **Company:** {{companyName}}
- **Work Location:** {{workLocation}}
- **Salary:** {{salary}} {{salaryPeriod}}
- **Reporting To:** {{reportsTo}}

### Document Status
- **Contract Signed:** {{contractSigned}}
- **Employee Signature:** {{employeeSigned}}
- **Employer Signature:** {{employerSigned}}
- **Witnesses:** {{witnessesSigned}}

### Additional Notes
{{additionalNotes}}

---
*Generated on {{generatedDate}}*`;

// Generate summary from staff data and contract metadata
function generateContractSummary(staff: StaffMember, contractMetadata?: ContractMetadata): string {
  const variables: Record<string, string> = {
    employeeName: staff.name || 'N/A',
    saIdNumber: staff.saIdNumber || 'N/A',
    position: formatLabel(staff.position, 'N/A'),
    department: formatLabel(staff.department, 'N/A'),
    startDate: formatDisplayDate(staff.startDate, 'N/A'),
    employmentType: contractMetadata?.employmentType || 'Permanent',
    companyName: contractMetadata?.companyName || 'Velocity Fibre (Pty) Ltd',
    workLocation: staff.workLocation || contractMetadata?.workLocation || 'N/A',
    salary: contractMetadata?.salary || 'As per contract',
    salaryPeriod: contractMetadata?.salaryPeriod || 'monthly',
    reportsTo: staff.managerName || staff.reportsTo || 'N/A',
    contractSigned: contractMetadata?.signatureDate ? `Yes (${formatDisplayDate(contractMetadata.signatureDate, 'N/A')})` : 'Pending',
    employeeSigned: contractMetadata?.employeeSigned === true || contractMetadata?.employeeSigned === 'true' ? '✅ Yes' : '❌ No',
    employerSigned: contractMetadata?.employerSigned === true || contractMetadata?.employerSigned === 'true' ? '✅ Yes' : '❌ No',
    witnessesSigned: contractMetadata?.witnessesSigned === true || contractMetadata?.witnessesSigned === 'true' ? '✅ Yes' : '⚠️ Not signed',
    additionalNotes: contractMetadata?.signatureNotes || 'None',
    generatedDate: formatDisplayDateTime(new Date()),
  };

  let summary = CONTRACT_SUMMARY_TEMPLATE;
  for (const [key, value] of Object.entries(variables)) {
    summary = summary.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }

  return summary;
}

export function NotesTab({ staff, staffId }: NotesTabProps) {
  const [notes, setNotes] = useState<StaffNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteType, setNewNoteType] = useState<StaffNote['noteType']>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [contractMetadata, setContractMetadata] = useState<ContractMetadata | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  // Toggle note expansion
  const toggleNoteExpanded = (noteId: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  // Parse note content - handles JSON format for document notes
  const parseNoteContent = (content: string): { summary: string; details?: string[]; isJson: boolean } => {
    try {
      const parsed = JSON.parse(content);
      if (parsed.summary && parsed.fields) {
        return {
          summary: parsed.summary,
          details: parsed.fields,
          isJson: true,
        };
      }
    } catch {
      // Not JSON, return as plain text
    }
    return { summary: content, isJson: false };
  };

  // Fetch notes for this staff member
  const fetchNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/staff/${staffId}/notes`);
      if (!response.ok) {
        if (response.status === 404) {
          // No notes yet - that's fine
          setNotes([]);
          return;
        }
        throw new Error('Failed to fetch notes');
      }
      const data = await response.json();
      // API returns { success, data: { notes } } or legacy { notes }
      setNotes(data.data?.notes || data.notes || []);
    } catch (err) {
      log.error('Failed to fetch staff notes', { staffId, error: err });
      setError('Failed to load notes');
    } finally {
      setIsLoading(false);
    }
  }, [staffId]);

  // Fetch contract metadata from documents
  const fetchContractMetadata = useCallback(async () => {
    try {
      const response = await fetch(`/api/staff/${staffId}/documents`);
      if (response.ok) {
        const data = await response.json();
        // Find employment contract with OCR metadata
        interface StaffDocument {
          documentType: string;
          ocrMetadata?: ContractMetadata;
        }
        const contract = data.documents?.find(
          (doc: StaffDocument) => doc.documentType === 'employment_contract' && doc.ocrMetadata
        );
        if (contract?.ocrMetadata) {
          setContractMetadata(contract.ocrMetadata);
        }
      }
    } catch (err) {
      log.warn('Failed to fetch contract metadata', { staffId, error: err });
    }
  }, [staffId]);

  useEffect(() => {
    fetchNotes();
    fetchContractMetadata();
  }, [fetchNotes, fetchContractMetadata]);

  // Add a new note
  const handleAddNote = async () => {
    if (!newNoteContent.trim()) {
      notificationService.error('Note content is required');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/staff/${staffId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteType: newNoteType,
          title: newNoteTitle.trim() || undefined,
          content: newNoteContent.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save note');
      }

      notificationService.success('Note added successfully');
      setNewNoteContent('');
      setNewNoteTitle('');
      setNewNoteType('general');
      setShowAddNote(false);
      fetchNotes();
    } catch (err) {
      log.error('Failed to add note', { staffId, error: err });
      notificationService.error('Failed to add note');
    } finally {
      setIsSaving(false);
    }
  };

  // Generate contract summary
  const handleGenerateSummary = async () => {
    setIsGenerating(true);
    try {
      const summary = generateContractSummary(staff, contractMetadata || undefined);

      // Save as a contract_summary note
      const response = await fetch(`/api/staff/${staffId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteType: 'contract_summary',
          title: 'Employment Contract Summary',
          content: summary,
          metadata: { contractMetadata },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save summary');
      }

      notificationService.success('Contract summary generated');
      fetchNotes();
    } catch (err) {
      log.error('Failed to generate summary', { staffId, error: err });
      notificationService.error('Failed to generate summary');
    } finally {
      setIsGenerating(false);
    }
  };

  // Delete a note
  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Are you sure you want to delete this note?')) return;

    try {
      const response = await fetch(`/api/staff/${staffId}/notes/${noteId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete note');
      }

      notificationService.success('Note deleted');
      fetchNotes();
    } catch (err) {
      log.error('Failed to delete note', { noteId, error: err });
      notificationService.error('Failed to delete note');
    }
  };

  // Copy note content to clipboard
  const handleCopyNote = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notificationService.success('Copied to clipboard');
    } catch {
      notificationService.error('Failed to copy');
    }
  };

  // Get note type icon and color
  const getNoteTypeInfo = (type: StaffNote['noteType']) => {
    switch (type) {
      case 'contract_summary':
        return { icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Contract Summary' };
      case 'hr_note':
        return { icon: User, color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'HR Note' };
      case 'document_note':
        return { icon: FileText, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Document Note' };
      case 'system':
        return { icon: Sparkles, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'System' };
      default:
        return { icon: MessageSquare, color: 'text-gray-400', bg: 'bg-gray-500/20', label: 'General' };
    }
  };

  const formatDate = (dateStr: string) => {
    return formatDisplayDateTime(dateStr, 'Unknown date');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Notes & Comments</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateSummary}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 disabled:opacity-50"
          >
            {isGenerating ? (
              <InlineSpinner size="sm" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Generate Contract Summary
          </button>
          <button
            onClick={() => setShowAddNote(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Note
          </button>
        </div>
      </div>

      {/* Contract Metadata Preview */}
      {contractMetadata && (
        <div className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">Contract Data Available</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[var(--ff-text-secondary)]">Company</p>
              <p className="text-[var(--ff-text-primary)] font-medium">{contractMetadata.companyName || 'N/A'}</p>
            </div>
            <div>
              <p className="text-[var(--ff-text-secondary)]">Position</p>
              <p className="text-[var(--ff-text-primary)] font-medium">{contractMetadata.jobTitle || 'N/A'}</p>
            </div>
            <div>
              <p className="text-[var(--ff-text-secondary)]">Salary</p>
              <p className="text-[var(--ff-text-primary)] font-medium">{contractMetadata.salary || 'N/A'}</p>
            </div>
            <div>
              <p className="text-[var(--ff-text-secondary)]">Signatures</p>
              <p className="text-[var(--ff-text-primary)] font-medium">
                {contractMetadata.employeeSigned ? '✅' : '❌'} Employee {' '}
                {contractMetadata.employerSigned ? '✅' : '❌'} Employer
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Add Note Form */}
      {showAddNote && (
        <div className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">Add New Note</h3>
            <button
              onClick={() => setShowAddNote(false)}
              className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              &times;
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">Note Type</label>
              <select
                value={newNoteType}
                onChange={(e) => setNewNoteType(e.target.value as StaffNote['noteType'])}
                className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
              >
                <option value="general">General Note</option>
                <option value="hr_note">HR Note</option>
                <option value="document_note">Document Note</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">Title (optional)</label>
              <input
                type="text"
                value={newNoteTitle}
                onChange={(e) => setNewNoteTitle(e.target.value)}
                placeholder="Note title..."
                className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">Content</label>
            <textarea
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              placeholder="Enter note content..."
              rows={4}
              className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] resize-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAddNote(false)}
              className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              Cancel
            </button>
            <button
              onClick={handleAddNote}
              disabled={isSaving || !newNoteContent.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Notes List */}
      {notes.length === 0 ? (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-8 text-center">
          <MessageSquare className="w-12 h-12 text-[var(--ff-text-muted)] mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">No notes yet</p>
          <p className="text-sm text-[var(--ff-text-muted)] mt-1">
            Add notes or generate a contract summary to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => {
            const typeInfo = getNoteTypeInfo(note.noteType);
            const TypeIcon = typeInfo.icon;
            const isExpanded = expandedNotes.has(note.id);
            const parsed = parseNoteContent(note.content);
            const createdByDisplay = note.createdByName || note.createdBy;

            return (
              <div
                key={note.id}
                className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden"
              >
                {/* Note Header - Clickable for expand/collapse */}
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--ff-bg-hover)] transition-colors"
                  onClick={() => toggleNoteExpanded(note.id)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Expand/collapse indicator */}
                    {parsed.isJson ? (
                      isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-[var(--ff-text-secondary)] flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[var(--ff-text-secondary)] flex-shrink-0" />
                      )
                    ) : (
                      <div className={`p-1.5 rounded ${typeInfo.bg} flex-shrink-0`}>
                        <TypeIcon className={`w-4 h-4 ${typeInfo.color}`} />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {parsed.isJson && (
                          <div className={`p-1 rounded ${typeInfo.bg} flex-shrink-0`}>
                            <TypeIcon className={`w-3 h-3 ${typeInfo.color}`} />
                          </div>
                        )}
                        <p className="font-medium text-[var(--ff-text-primary)] truncate">
                          {note.title || typeInfo.label}
                        </p>
                      </div>
                      <p className="text-xs text-[var(--ff-text-secondary)] flex items-center gap-2 mt-0.5">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span>{formatDate(note.createdAt)}</span>
                        {createdByDisplay && (
                          <>
                            <span className="text-[var(--ff-text-muted)]">•</span>
                            <User className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{createdByDisplay}</span>
                          </>
                        )}
                        {parsed.isJson && parsed.details && (
                          <>
                            <span className="text-[var(--ff-text-muted)]">•</span>
                            <span className="text-green-400">{parsed.details.length} fields synced</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleCopyNote(parsed.isJson ? parsed.details?.join('\n') || note.content : note.content)}
                      className="p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded"
                      title="Copy to clipboard"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDeleteNote(note.id)}
                      className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded"
                      title="Delete note"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Note Content - Expandable for JSON notes, always shown for plain text */}
                {(isExpanded || !parsed.isJson) && (
                  <div className="px-4 pb-4 pt-0 border-t border-[var(--ff-border-light)]">
                    {parsed.isJson && parsed.details ? (
                      <div className="mt-3 space-y-1">
                        {parsed.details.map((field, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <span className="text-green-400">•</span>
                            <span className="text-[var(--ff-text-primary)]">{field}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <pre className="mt-3 text-sm text-[var(--ff-text-primary)] whitespace-pre-wrap font-sans">
                        {note.content}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
