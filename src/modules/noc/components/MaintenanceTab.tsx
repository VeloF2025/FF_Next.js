/**
 * MaintenanceTab Component
 *
 * Displays WhatsApp maintenance messages and photos for a specific DR.
 * Used in the DR Review page to show maintenance issue tracking.
 *
 * Features:
 * - Message timeline with sender info
 * - Photo gallery from WhatsApp
 * - Maintenance flag status
 * - Create ticket button
 *
 * @module maintenance/components/MaintenanceTab
 */

'use client';

import { useState, useEffect } from 'react';
import { formatDisplayDateTime } from '@/utils/dateFormat';
import {
  MessageSquare,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle,
  Clock,
  Ticket,
  RefreshCw,
  User,
  ExternalLink,
} from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

interface MaintenanceMessage {
  id: string;
  message_text: string | null;
  sender_name: string | null;
  message_timestamp: string;
  has_media: boolean;
  photo_count: number;
}

interface MaintenancePhoto {
  id: string;
  original_filename: string | null;
  mime_type: string;
  sharepoint_url: string | null;
  upload_status: string;
  photo_index: number;
  created_at: string;
}

interface MaintenanceFlag {
  id: string;
  drop_number: string;
  project: string;
  has_maintenance_issue: boolean;
  issue_status: string;
  issue_type: string | null;
  issue_description: string | null;
  maintenance_ticket_id: string | null;
  wa_message_count: number;
  wa_photo_count: number;
  first_reported_at: string;
  last_activity_at: string;
  resolved_at: string | null;
}

interface MaintenanceData {
  drop_number: string;
  flag: MaintenanceFlag | null;
  messages: MaintenanceMessage[];
  photos: MaintenancePhoto[];
  message_count: number;
  photo_count: number;
}

interface MaintenanceTabProps {
  dropNumber: string;
  onCreateTicket?: (dropNumber: string) => void;
}

export function MaintenanceTab({ dropNumber, onCreateTicket }: MaintenanceTabProps) {
  const [data, setData] = useState<MaintenanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketCreated, setTicketCreated] = useState<{ id: string; uid: string } | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/noc/wa-messages?drop_number=${encodeURIComponent(dropNumber)}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch maintenance data');
      }

      const result = await response.json();
      if (result.success) {
        setData(result.data);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTicket = async () => {
    if (onCreateTicket) {
      onCreateTicket(dropNumber);
      return;
    }

    setIsCreatingTicket(true);
    setTicketError(null);

    try {
      const response = await fetch('/api/noc/wa-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drop_number: dropNumber }),
      });

      const result = await response.json();

      if (result.success && result.data) {
        setTicketCreated({
          id: result.data.ticket_id,
          uid: result.data.ticket_uid,
        });
        // Refresh data to show updated status
        fetchData();
      } else {
        throw new Error(result.error || 'Failed to create ticket');
      }
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setIsCreatingTicket(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dropNumber]);

  if (isLoading) {
    return <LoadingSpinner className="min-h-[300px]" size="lg" label="Loading maintenance data..." />;
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-2">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          <h3 className="text-red-800 dark:text-red-200 font-semibold">Error Loading Data</h3>
        </div>
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.message_count === 0) {
    return (
      <div className="bg-background/50 rounded-lg p-8 text-center">
        <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">
          No Maintenance Messages
        </h3>
        <p className="text-muted-foreground">
          No maintenance-related WhatsApp messages found for {dropNumber}.
        </p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    flagged: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200',
    reviewing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
    ticket_created: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200',
    resolved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    flagged: <AlertTriangle className="h-4 w-4" />,
    reviewing: <Clock className="h-4 w-4" />,
    ticket_created: <Ticket className="h-4 w-4" />,
    resolved: <CheckCircle className="h-4 w-4" />,
  };

  return (
    <div className="space-y-6">
      {/* Header with Status */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-orange-600" />
            Maintenance Issue Tracking
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            WhatsApp messages and photos related to maintenance issues for this DR.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-5 w-5" />
        </button>
      </div>

      {/* Status Card */}
      {data.flag && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                  statusColors[data.flag.issue_status] || statusColors.flagged
                }`}
              >
                {statusIcons[data.flag.issue_status] || statusIcons.flagged}
                {data.flag.issue_status.replace('_', ' ').toUpperCase()}
              </span>

              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <MessageSquare className="h-4 w-4" />
                  <span>{data.flag.wa_message_count} messages</span>
                </div>
                <div className="flex items-center gap-1">
                  <ImageIcon className="h-4 w-4" />
                  <span>{data.flag.wa_photo_count} photos</span>
                </div>
              </div>
            </div>

            {data.flag.issue_status !== 'resolved' && data.flag.issue_status !== 'ticket_created' && (
              <button
                onClick={handleCreateTicket}
                disabled={isCreatingTicket}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isCreatingTicket ? (
                  <>
                    <InlineSpinner size="sm" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Ticket className="h-4 w-4" />
                    Create Ticket
                  </>
                )}
              </button>
            )}
            {ticketCreated && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200">
                <CheckCircle className="h-4 w-4" />
                Ticket {ticketCreated.uid}
              </span>
            )}
          </div>

          {ticketError && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {ticketError}
              </p>
            </div>
          )}

          {data.flag.issue_description && (
            <p className="mt-3 text-sm text-muted-foreground border-t border-gray-100 dark:border-gray-700 pt-3">
              {data.flag.issue_description}
            </p>
          )}

          <div className="mt-3 flex items-center gap-6 text-xs text-muted-foreground dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-3">
            <span>
              First reported:{' '}
              {formatDisplayDateTime(data.flag.first_reported_at)}
            </span>
            <span>
              Last activity:{' '}
              {formatDisplayDateTime(data.flag.last_activity_at)}
            </span>
            {data.flag.resolved_at && (
              <span className="text-green-600 dark:text-green-400">
                Resolved: {formatDisplayDateTime(data.flag.resolved_at)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Message Timeline */}
      <div>
        <h4 className="text-sm font-medium text-foreground mb-4">
          Message Timeline
        </h4>
        <div className="space-y-3">
          {data.messages.map((message) => (
            <div
              key={message.id}
              className="bg-card border border-border rounded-lg p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">
                      {message.sender_name || 'Unknown'}
                    </span>
                    <span className="text-xs text-muted-foreground dark:text-gray-400">
                      {formatDisplayDateTime(message.message_timestamp)}
                    </span>
                  </div>
                  {message.message_text && (
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                      {message.message_text}
                    </p>
                  )}
                  {message.has_media && message.photo_count > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-sm text-blue-600 dark:text-blue-400">
                        {message.photo_count} photo{message.photo_count > 1 ? 's' : ''} attached
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Photos Grid */}
      {data.photos.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-4">
            Photos ({data.photos.length})
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {data.photos.map((photo) => (
              <div
                key={photo.id}
                className="bg-card border border-border rounded-lg overflow-hidden"
              >
                {photo.sharepoint_url ? (
                  <a
                    href={photo.sharepoint_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square bg-background relative group"
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-gray-400" />
                    </div>
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <ExternalLink className="h-6 w-6 text-white" />
                    </div>
                  </a>
                ) : (
                  <div className="aspect-square bg-background flex items-center justify-center">
                    <div className="text-center">
                      <ImageIcon className="h-8 w-8 text-gray-400 mx-auto mb-1" />
                      <span className="text-xs text-muted-foreground">
                        {photo.upload_status === 'pending' && 'Pending upload'}
                        {photo.upload_status === 'uploading' && 'Uploading...'}
                        {photo.upload_status === 'failed' && 'Upload failed'}
                      </span>
                    </div>
                  </div>
                )}
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  <div className="truncate">
                    {photo.original_filename || `Photo ${photo.photo_index}`}
                  </div>
                  <div className="text-muted-foreground">
                    {formatDisplayDateTime(photo.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
