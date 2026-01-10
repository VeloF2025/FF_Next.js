/**
 * AdminDashboard Component - Management interface for admin functions
 * Includes contractor document approval and other admin tasks
 */

import { useState } from 'react';
import { 
  FileText, 
  Users, 
  Shield, 
  Settings,
  BarChart3,
  CheckCircle,
  Clock,
  AlertCircle
} from 'lucide-react';
import { DocumentApprovalPanel } from '../contractors/components/admin/DocumentApprovalPanel';

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'contractors' | 'compliance' | 'settings'>('documents');

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Admin Dashboard</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">Manage contractors, documents, and system settings</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Pending Approvals</p>
              <p className="text-2xl font-bold text-yellow-600">12</p>
            </div>
            <div className="p-3 bg-yellow-500/20 rounded-lg">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Active Contractors</p>
              <p className="text-2xl font-bold text-blue-600">28</p>
            </div>
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Documents Approved</p>
              <p className="text-2xl font-bold text-green-600">156</p>
            </div>
            <div className="p-3 bg-green-500/20 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Compliance Issues</p>
              <p className="text-2xl font-bold text-red-600">3</p>
            </div>
            <div className="p-3 bg-red-500/20 rounded-lg">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] mb-6">
        <div className="flex space-x-1 border-b border-[var(--ff-border-light)] px-6">
          <button
            onClick={() => setActiveTab('documents')}
            className={`px-4 py-3 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'documents'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            <FileText className="w-4 h-4" />
            Document Approvals
          </button>
          <button
            onClick={() => setActiveTab('contractors')}
            className={`px-4 py-3 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'contractors'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            <Users className="w-4 h-4" />
            Contractor Management
          </button>
          <button
            onClick={() => setActiveTab('compliance')}
            className={`px-4 py-3 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'compliance'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            <Shield className="w-4 h-4" />
            Compliance
          </button>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'overview'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Reports
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-3 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>

        <div className="p-6">
          {/* Tab Content */}
          {activeTab === 'documents' && (
            <DocumentApprovalPanel />
          )}

          {activeTab === 'contractors' && (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">Contractor Management</h3>
              <p className="text-[var(--ff-text-secondary)]">Contractor management features coming soon</p>
            </div>
          )}

          {activeTab === 'compliance' && (
            <div className="text-center py-12">
              <Shield className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">Compliance Dashboard</h3>
              <p className="text-[var(--ff-text-secondary)]">Compliance monitoring features coming soon</p>
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="text-center py-12">
              <BarChart3 className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">Reports & Analytics</h3>
              <p className="text-[var(--ff-text-secondary)]">Reporting features coming soon</p>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="text-center py-12">
              <Settings className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">System Settings</h3>
              <p className="text-[var(--ff-text-secondary)]">Settings panel coming soon</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}