/**
 * Document Status Table Component
 *
 * Displays contractor documents in a table format with status, expiry, and actions
 */

import React from 'react';
import { FileText, Eye, Upload, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DocumentInfo, TeamMemberDocuments } from '../types/documentReport.types';
import DocumentStatusBadge from './DocumentStatusBadge';
import { formatExpiryDate, getActionButtonText } from '../utils/documentStatusRules';

interface DocumentStatusTableProps {
  companyDocuments: DocumentInfo[];
  teamDocuments: TeamMemberDocuments[];
  onViewDocument?: (doc: DocumentInfo) => void;
  onUploadDocument?: (docType: string) => void;
}

export default function DocumentStatusTable({
  companyDocuments,
  teamDocuments,
  onViewDocument,
  onUploadDocument,
}: DocumentStatusTableProps) {
  return (
    <div className="space-y-6">
      {/* Company Documents Section */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
          <FileText size={20} />
          Company Documents ({companyDocuments.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="min-w-full bg-card border border-border rounded-lg">
            <thead className="bg-background">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  Document Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  Expiry Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {companyDocuments.map((doc) => (
                <tr key={doc.id} className="hover:bg-background">
                  <td className="px-4 py-3 text-sm font-medium text-foreground">{doc.type}</td>
                  <td className="px-4 py-3">
                    <DocumentStatusBadge status={doc.displayStatus} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatExpiryDate(doc.expiryDate, doc.daysUntilExpiry || null)}
                  </td>
                  <td className="px-4 py-3">
                    <ActionButton
                      doc={doc}
                      onView={onViewDocument}
                      onUpload={onUploadDocument}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Team Member Documents Section */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
          <FileText size={20} />
          Team Member IDs ({teamDocuments.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="min-w-full bg-card border border-border rounded-lg">
            <thead className="bg-background">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  Team Member
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  ID Document Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {teamDocuments.map((member) => (
                <tr key={member.teamMemberId} className="hover:bg-background">
                  <td className="px-4 py-3 text-sm font-medium text-foreground">
                    {member.memberName}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{member.role}</td>
                  <td className="px-4 py-3">
                    <DocumentStatusBadge status={member.displayStatus} size="sm" />
                  </td>
                  <td className="px-4 py-3">
                    {member.idDocument ? (
                      <ActionButton
                        doc={member.idDocument}
                        onView={onViewDocument}
                        onUpload={onUploadDocument}
                      />
                    ) : (
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => onUploadDocument?.('ID Document')}
                      >
                        Upload
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Action Button Component
 */
function ActionButton({
  doc,
  onView,
  onUpload,
}: {
  doc: DocumentInfo;
  onView?: (doc: DocumentInfo) => void;
  onUpload?: (docType: string) => void;
}) {
  const actionText = getActionButtonText(doc.displayStatus);
  const isViewable = doc.displayStatus === 'verified' || doc.displayStatus === 'pending' || doc.displayStatus === 'expiring';

  if (isViewable && doc.fileUrl) {
    return (
      <Button variant="link" size="sm" onClick={() => onView?.(doc)}>
        <Eye size={14} />
        {actionText}
      </Button>
    );
  }

  if (doc.displayStatus === 'rejected') {
    return (
      <Button variant="link" size="sm" onClick={() => onUpload?.(doc.type)}>
        <RefreshCw size={14} />
        {actionText}
      </Button>
    );
  }

  return (
    <Button variant="link" size="sm" onClick={() => onUpload?.(doc.type)}>
      <Upload size={14} />
      {actionText}
    </Button>
  );
}
