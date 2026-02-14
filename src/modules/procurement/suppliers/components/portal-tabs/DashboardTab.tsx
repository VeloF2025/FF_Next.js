import React from 'react';
import { FileText, CheckCircle, Award, TrendingUp, AlertTriangle, Clock } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';
import type { SupplierStats, RFQInvitation } from '../../types/portal.types';

export interface DashboardTabProps {
  stats: SupplierStats | null;
  rfqInvitations: RFQInvitation[];
  onOpenQuoteModal: (rfq: RFQInvitation) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({ stats, rfqInvitations, onOpenQuoteModal }) => {
  const getComplianceColor = (status: string) => {
    switch (status) {
      case 'compliant': return 'text-green-600 bg-green-50';
      case 'pending': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-red-600 bg-red-50';
    }
  };

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
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <GlassCard>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Active RFQs</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats?.activeRFQs || 0}</p>
            </div>
            <FileText className="h-8 w-8 text-blue-500" />
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Completed Quotes</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats?.completedQuotes || 0}</p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Average Score</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats?.averageScore || 0}/5</p>
            </div>
            <Award className="h-8 w-8 text-yellow-500" />
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Win Rate</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats?.winRate || 0}%</p>
            </div>
            <TrendingUp className="h-8 w-8 text-indigo-500" />
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent RFQs */}
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent RFQ Invitations</h3>
            <span className="text-sm text-gray-500 dark:text-gray-400">{rfqInvitations.length} active</span>
          </div>
          <div className="space-y-3">
            {rfqInvitations.slice(0, 3).map((rfq) => (
              <div key={rfq.id} className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900 dark:text-gray-100">{rfq.title}</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{rfq.projectName}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className={`text-xs px-2 py-1 rounded-full ${getUrgencyColor(rfq.urgency)}`}>
                      {rfq.urgency}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Due: {new Date(rfq.dueDate).toISOString().split('T')[0]}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {getStatusIcon(rfq.status)}
                  <VelocityButton size="sm">View</VelocityButton>
                  {rfq.status === 'pending' && (
                    <VelocityButton size="sm" onClick={() => onOpenQuoteModal(rfq)}>
                      Quote
                    </VelocityButton>
                  )}
                </div>
              </div>
            ))}
          </div>
          {rfqInvitations.length > 3 && (
            <div className="mt-4 text-center">
              <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                View all RFQs →
              </button>
            </div>
          )}
        </GlassCard>

        {/* Compliance Status */}
        <GlassCard>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Compliance Status</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-700 dark:text-gray-300">Overall Status</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                stats ? getComplianceColor(stats.complianceStatus) : 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900'
              }`}>
                {stats?.complianceStatus || 'Unknown'}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Tax Compliance</span>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">BEE Certificate</span>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Insurance</span>
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              </div>
            </div>

            {stats?.documentsExpiring && stats.documentsExpiring > 0 && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm text-yellow-800">
                    {stats.documentsExpiring} document(s) expiring soon
                  </span>
                </div>
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
