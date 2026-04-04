import React, { useState } from 'react';
import { Bell, TrendingUp, FileText, User, Award, Upload, MessageSquare } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { RFQInvitation, SupplierPortalTab } from './types/portal.types';
import { QuoteSubmissionModal } from './components/quote-modal';
import { log } from '@/lib/logger';
import { useSupplierAuth } from './hooks/useSupplierAuth';
import {
  DashboardTab,
  RFQsTab,
  ProfileTab,
  PerformanceTab,
  DocumentsTab,
  MessagesTab
} from './components/portal-tabs';

interface SupplierPortalProps {}

const SupplierPortalPage: React.FC<SupplierPortalProps> = () => {
  const [activeTab, setActiveTab] = useState<SupplierPortalTab>('dashboard');
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [selectedRFQ, setSelectedRFQ] = useState<RFQInvitation | null>(null);

  const {
    supplierSession,
    loading,
    supplier,
    stats,
    rfqInvitations,
    authEmail,
    setAuthEmail,
    authStep,
    setAuthStep,
    verificationCode,
    setVerificationCode,
    handleAuthentication,
    handleVerification,
    setDemoSession,
    setRFQInvitations,
    setStats
  } = useSupplierAuth();

  const handleOpenQuoteModal = (rfq: RFQInvitation) => {
    setSelectedRFQ(rfq);
    setShowQuoteModal(true);
  };

  const handleSubmitQuote = async (quoteData: any) => {
    try {
      // In production, this would submit the quote via the API

      // Update the RFQ status to submitted
      setRFQInvitations(prev =>
        prev.map(rfq =>
          rfq.id === quoteData.rfqId
            ? { ...rfq, status: 'submitted' as const }
            : rfq
        )
      );

      // Update stats
      setStats(prev => prev ? {
        ...prev,
        activeRFQs: prev.activeRFQs - 1,
        completedQuotes: prev.completedQuotes + 1
      } : null);

    } catch (error) {
      log.error('Failed to submit quote:', { data: error }, 'SupplierPortalPage');
      throw error;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!supplierSession?.authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <GlassCard className="w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-foreground mb-2">Supplier Portal</h1>
            <p className="text-muted-foreground">Access your supplier dashboard</p>
          </div>

          {authStep === 'email' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your registered email"
                />
              </div>
              <VelocityButton
                onClick={() => handleAuthentication(authEmail)}
                disabled={!authEmail || loading}
                className="w-full"
              >
                {loading ? 'Sending...' : 'Send Magic Link'}
              </VelocityButton>
              <p className="text-sm text-muted-foreground text-center">
                We'll send you a secure login link via email
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Verification Code
                </label>
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter 6-digit code"
                />
              </div>
              <VelocityButton
                onClick={() => handleVerification(verificationCode)}
                disabled={!verificationCode || loading}
                className="w-full"
              >
                {loading ? 'Verifying...' : 'Verify & Login'}
              </VelocityButton>
              <Button variant="ghost" className="w-full" onClick={() => setAuthStep('email')}>← Back to email</Button>
            </div>
          )}

          {/* Demo Access Button */}
          <div className="mt-6 pt-6 border-t border-border">
            <VelocityButton
              onClick={setDemoSession}
              variant="outline"
              className="w-full"
            >
              Continue as Demo Supplier
            </VelocityButton>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Supplier Portal</h1>
              <p className="text-muted-foreground">Welcome, {supplierSession.supplierName}</p>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
                <Bell className="h-5 w-5" />
                {stats?.activeRFQs && stats.activeRFQs > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                    {stats.activeRFQs}
                  </span>
                )}
              </Button>
              <div className="flex items-center space-x-2">
                <User className="h-5 w-5 text-gray-400" />
                <span className="text-sm text-muted-foreground">{supplierSession.supplierEmail}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {[
              { key: 'dashboard', label: 'Dashboard', icon: TrendingUp },
              { key: 'rfqs', label: 'RFQ Invitations', icon: FileText },
              { key: 'profile', label: 'Company Profile', icon: User },
              { key: 'performance', label: 'Performance', icon: Award },
              { key: 'documents', label: 'Documents', icon: Upload },
              { key: 'messages', label: 'Messages', icon: MessageSquare }
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as SupplierPortalTab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                  activeTab === key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-muted-foreground hover:text-muted-foreground hover:border-border'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
                {key === 'rfqs' && stats?.activeRFQs && stats.activeRFQs > 0 && (
                  <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full">
                    {stats.activeRFQs}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <DashboardTab stats={stats} rfqInvitations={rfqInvitations} onOpenQuoteModal={handleOpenQuoteModal} />
        )}
        {activeTab === 'rfqs' && (
          <RFQsTab rfqInvitations={rfqInvitations} onOpenQuoteModal={handleOpenQuoteModal} />
        )}
        {activeTab === 'profile' && (
          <ProfileTab supplier={supplier} />
        )}
        {activeTab === 'performance' && (
          <PerformanceTab supplier={supplier} stats={stats} />
        )}
        {activeTab === 'documents' && (
          <DocumentsTab />
        )}
        {activeTab === 'messages' && (
          <MessagesTab />
        )}
      </div>

      {/* Quote Submission Modal */}
      <QuoteSubmissionModal
        rfq={selectedRFQ}
        isOpen={showQuoteModal}
        onClose={() => {
          setShowQuoteModal(false);
          setSelectedRFQ(null);
        }}
        onSubmit={handleSubmitQuote}
      />
    </div>
  );
};

export default SupplierPortalPage;
