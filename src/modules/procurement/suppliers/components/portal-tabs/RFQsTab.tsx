import React from 'react';
import { FileText, CheckCircle, Award, AlertTriangle, Clock } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';
import type { RFQInvitation } from '../../types/portal.types';

export interface RFQsTabProps {
  rfqInvitations: RFQInvitation[];
  onOpenQuoteModal: (rfq: RFQInvitation) => void;
}

export const RFQsTab: React.FC<RFQsTabProps> = ({ rfqInvitations, onOpenQuoteModal }) => {
  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'high': return 'text-red-600 bg-red-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-green-600 bg-green-50';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'submitted': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'awarded': return <Award className="h-4 w-4 text-blue-500" />;
      case 'rejected': return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-foreground">RFQ Invitations</h2>
        <div className="flex space-x-2">
          <select className="px-3 py-2 border border-border rounded-lg text-sm">
            <option>All Status</option>
            <option>Pending</option>
            <option>Submitted</option>
            <option>Awarded</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4">
        {rfqInvitations.map((rfq) => (
          <GlassCard key={rfq.id}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="text-lg font-semibold text-foreground">{rfq.title}</h3>
                  <span className={`text-xs px-2 py-1 rounded-full ${getUrgencyColor(rfq.urgency)}`}>
                    {rfq.urgency}
                  </span>
                </div>
                <p className="text-muted-foreground mb-2">{rfq.description}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">RFQ Number:</span>
                    <p className="font-medium">{rfq.rfqNumber}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Project:</span>
                    <p className="font-medium">{rfq.projectName}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Due Date:</span>
                    <p className="font-medium">{new Date(rfq.dueDate).toISOString().split('T')[0]}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Est. Value:</span>
                    <p className="font-medium">R{rfq.estimatedValue.toLocaleString()}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-3 ml-4">
                {getStatusIcon(rfq.status)}
                <span className="text-sm font-medium text-muted-foreground capitalize">{rfq.status}</span>
              </div>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-border">
              <div className="flex space-x-2">
                <VelocityButton size="sm" variant="outline">
                  <FileText className="h-4 w-4 mr-2" />
                  View Details
                </VelocityButton>
                {rfq.status === 'pending' && (
                  <VelocityButton size="sm" onClick={() => onOpenQuoteModal(rfq)}>
                    Submit Quote
                  </VelocityButton>
                )}
              </div>
              <span className="text-sm text-muted-foreground">
                {rfq.status === 'pending'
                  ? `${Math.ceil((new Date(rfq.dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days left`
                  : 'Completed'
                }
              </span>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
};
