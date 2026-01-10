import { useNavigate } from 'react-router-dom';
import { Calendar, Users, Clock, Send, CheckCircle, XCircle, Award, MoreVertical } from 'lucide-react';
import { RFQ, RFQStatus } from '@/types/procurement.types';
import { format } from 'date-fns';

interface RFQCardProps {
  rfq: RFQ;
}

export function RFQCard({ rfq }: RFQCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/procurement/rfq/${rfq.id}`);
  };

  const getStatusIcon = () => {
    switch (rfq.status) {
      case RFQStatus.ISSUED:
        return <Send className="h-4 w-4 text-blue-500" />;
      case RFQStatus.RESPONSES_RECEIVED:
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case RFQStatus.AWARDED:
        return <Award className="h-4 w-4 text-purple-500" />;
      case RFQStatus.CANCELLED:
        return <XCircle className="h-4 w-4 text-red-500" />;
      case RFQStatus.EVALUATED:
        return <Clock className="h-4 w-4 text-gray-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusColor = () => {
    switch (rfq.status) {
      case RFQStatus.DRAFT:
        return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]';
      case RFQStatus.ISSUED:
        return 'bg-blue-500/20 text-blue-400';
      case RFQStatus.RESPONSES_RECEIVED:
        return 'bg-yellow-500/20 text-yellow-400';
      case RFQStatus.EVALUATED:
        return 'bg-indigo-500/20 text-indigo-400';
      case RFQStatus.AWARDED:
        return 'bg-purple-500/20 text-purple-400';
      case RFQStatus.CANCELLED:
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]';
    }
  };

  const respondedCount = rfq.respondedSuppliers?.length || 0;
  const totalInvited = rfq.invitedSuppliers?.length || 0;

  return (
    <div
      onClick={handleClick}
      className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)] hover:shadow-lg transition-shadow cursor-pointer"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {getStatusIcon()}
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor()}`}>
              {rfq.status}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{rfq.title}</h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">{rfq.rfqNumber}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            // TODO: Show dropdown menu
          }}
          className="p-1 hover:bg-[var(--ff-bg-hover)] rounded"
        >
          <MoreVertical className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
        </button>
      </div>

      <div className="space-y-2 mb-4">
        {rfq.projectId && (
          <div className="flex items-center text-sm text-[var(--ff-text-secondary)]">
            <span className="font-medium mr-2">Project ID:</span>
            <span>{rfq.projectId}</span>
          </div>
        )}
        <div className="flex items-center text-sm text-[var(--ff-text-secondary)]">
          <Calendar className="h-4 w-4 mr-2 text-[var(--ff-text-tertiary)]" />
          <span>Deadline: {rfq.responseDeadline ? format(rfq.responseDeadline, 'MMM dd, yyyy') : 'N/A'}</span>
        </div>
        <div className="flex items-center text-sm text-[var(--ff-text-secondary)]">
          <Users className="h-4 w-4 mr-2 text-[var(--ff-text-tertiary)]" />
          <span>{totalInvited} suppliers invited</span>
        </div>
      </div>

      <div className="border-t border-[var(--ff-border-light)] pt-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-[var(--ff-text-secondary)]">Responses</p>
            <p className="text-lg font-bold text-[var(--ff-text-primary)]">
              {respondedCount} / {totalInvited}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--ff-text-secondary)]">{rfq.itemCount} items</p>
            {rfq.responseDeadline && (
              <p className="text-xs text-[var(--ff-text-secondary)]">
                Response Due: {format(rfq.responseDeadline, 'MMM dd')}
              </p>
            )}
          </div>
        </div>
      </div>

      {rfq.awardedTo && (
        <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)]">
          <p className="text-xs text-green-400 font-medium">
            ✓ Supplier selected
          </p>
        </div>
      )}

      {/* Response progress bar */}
      {rfq.status !== RFQStatus.DRAFT && totalInvited > 0 && (
        <div className="mt-3">
          <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${(respondedCount / totalInvited) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}