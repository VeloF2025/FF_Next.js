/**
 * Supplier Detail Page
 * View and manage supplier information with tabs
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  Globe,
  MapPin,
  Star,
  Edit,
  Trash2,
  AlertTriangle,
  FileText,
  ShoppingCart,
  Send,
  BarChart3,
  Loader2,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

interface Supplier {
  id: string;
  name: string;
  companyName?: string;
  tradingName?: string;
  email: string;
  phone: string;
  website?: string;
  status: string;
  businessType?: string;
  registrationNumber?: string;
  taxNumber?: string;
  // Address fields from mapSupplier
  addresses?: {
    physical?: {
      street1?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    };
  };
  // Contact from mapSupplier
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  primaryContact?: {
    name?: string;
    title?: string;
    email?: string;
    phone?: string;
  };
  rating?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Form data uses snake_case to match backend fieldMapping
interface SupplierFormData {
  id?: string;
  name?: string;
  company_name?: string;
  trading_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  status?: string;
  business_type?: string;
  registration_number?: string;
  tax_number?: string;
  physical_address?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  country?: string;
  contact_name?: string;
  notes?: string;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  total_amount: number;
  created_at: string;
}

interface RFQInvite {
  id: string;
  rfq_number: string;
  title: string;
  status: string;
  response_deadline: string;
}

export default function SupplierDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [rfqInvites, setRfqInvites] = useState<RFQInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'profile' | 'performance' | 'documents' | 'orders' | 'rfqs'>('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<SupplierFormData>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Transform API response (camelCase) to form fields (snake_case for editing)
  const transformForForm = (data: Supplier): SupplierFormData => {
    return {
      id: data.id,
      name: data.name,
      company_name: data.name || data.companyName,  // Use name as main identifier
      trading_name: data.tradingName,
      email: data.email,
      phone: data.phone,
      website: data.website,
      status: data.status,
      business_type: data.businessType,
      registration_number: data.registrationNumber,
      tax_number: data.taxNumber,
      physical_address: data.addresses?.physical?.street1,
      city: data.addresses?.physical?.city,
      province: data.addresses?.physical?.state,
      postal_code: data.addresses?.physical?.postalCode,
      country: data.addresses?.physical?.country || 'South Africa',
      contact_name: data.primaryContact?.name || data.contact?.name,
      notes: data.notes
    };
  };

  // Load supplier data
  useEffect(() => {
    if (id && typeof id === 'string') {
      loadSupplierData(id);
    }
  }, [id]);

  const loadSupplierData = async (supplierId: string) => {
    try {
      setIsLoading(true);

      // Fetch supplier details
      const supplierRes = await fetch(`/api/suppliers/${supplierId}`);
      if (!supplierRes.ok) {
        if (supplierRes.status === 404) {
          toast.error('Supplier not found');
          router.push('/suppliers');
          return;
        }
        throw new Error('Failed to fetch supplier');
      }
      const supplierData = await supplierRes.json();
      const data = supplierData.data || supplierData;
      setSupplier(data);
      setEditForm(transformForForm(data));

      // Fetch purchase orders (if endpoint exists)
      try {
        const poRes = await fetch(`/api/procurement/purchase-orders?supplierId=${supplierId}`);
        if (poRes.ok) {
          const poData = await poRes.json();
          setPurchaseOrders(poData.data || poData.purchaseOrders || []);
        }
      } catch {
        // PO endpoint may not exist yet
      }

      // Fetch RFQ invites
      try {
        const rfqRes = await fetch(`/api/procurement/rfq?supplierId=${supplierId}`);
        if (rfqRes.ok) {
          const rfqData = await rfqRes.json();
          setRfqInvites(rfqData.rfqs || []);
        }
      } catch {
        // RFQ endpoint may not work with supplier filter
      }

    } catch (error) {
      log.error('Failed to load supplier:', { data: error }, 'SupplierDetailPage');
      toast.error('Failed to load supplier details');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!id || typeof id !== 'string') return;

    setIsSaving(true);
    try {
      // Filter out null/undefined values to avoid overwriting with nulls
      const cleanedData: Record<string, any> = {};
      Object.entries(editForm).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          cleanedData[key] = value;
        }
      });

      // Also update the 'name' field if company_name changed
      if (cleanedData.company_name) {
        cleanedData.name = cleanedData.company_name;
      }

      const response = await fetch(`/api/suppliers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: cleanedData })
      });

      if (!response.ok) {
        throw new Error('Failed to update supplier');
      }

      // Reload supplier data to get fresh values from DB
      await loadSupplierData(id);
      setIsEditing(false);
      toast.success('Supplier updated successfully');
    } catch (error) {
      log.error('Failed to update supplier:', { data: error }, 'SupplierDetailPage');
      toast.error('Failed to update supplier');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (soft: boolean) => {
    if (!id || typeof id !== 'string') return;

    try {
      const response = await fetch(`/api/suppliers/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soft, reason: 'Deleted via supplier detail page' })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Handle 409 Conflict - supplier has dependencies
        if (response.status === 409) {
          const deps = errorData.dependencies || {};
          const parts: string[] = [];
          if (deps.purchaseOrders > 0) parts.push(`${deps.purchaseOrders} PO${deps.purchaseOrders > 1 ? 's' : ''}`);
          if (deps.rfqs > 0) parts.push(`${deps.rfqs} RFQ${deps.rfqs > 1 ? 's' : ''}`);
          if (deps.boqItems > 0) parts.push(`${deps.boqItems} BOQ item${deps.boqItems > 1 ? 's' : ''}`);
          if (deps.grns > 0) parts.push(`${deps.grns} GRN${deps.grns > 1 ? 's' : ''}`);

          toast.error(
            `Cannot delete: supplier has ${parts.join(', ')}. Use "Deactivate" instead.`,
            { duration: 6000 }
          );
          setShowDeleteDialog(false);
          return;
        }

        throw new Error(errorData.message || 'Failed to delete supplier');
      }

      toast.success(soft ? 'Supplier deactivated' : 'Supplier deleted');
      router.push('/suppliers');
    } catch (error) {
      log.error('Failed to delete supplier:', { data: error }, 'SupplierDetailPage');
      toast.error(error instanceof Error ? error.message : 'Failed to delete supplier');
    }
    setShowDeleteDialog(false);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
      active: { color: 'bg-green-100 text-green-800', icon: <CheckCircle className="h-3 w-3" /> },
      approved: { color: 'bg-green-100 text-green-800', icon: <CheckCircle className="h-3 w-3" /> },
      pending: { color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="h-3 w-3" /> },
      inactive: { color: 'bg-gray-100 text-gray-800', icon: <XCircle className="h-3 w-3" /> },
      suspended: { color: 'bg-red-100 text-red-800', icon: <AlertTriangle className="h-3 w-3" /> },
      blacklisted: { color: 'bg-red-100 text-red-800', icon: <XCircle className="h-3 w-3" /> }
    };

    const config = (statusConfig[status.toLowerCase()] || statusConfig.pending)!;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
        {config.icon}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className="ml-2 text-gray-500">Loading supplier...</span>
        </div>
      </AppLayout>
    );
  }

  if (!supplier) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-96">
          <AlertTriangle className="h-12 w-12 text-yellow-500 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Supplier not found</h2>
          <Button onClick={() => router.push('/suppliers')} className="mt-4">
            Back to Suppliers
          </Button>
        </div>
      </AppLayout>
    );
  }

  const tabs = [
    { id: 'profile', label: 'Profile', icon: Building2 },
    { id: 'performance', label: 'Performance', icon: BarChart3 },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'orders', label: 'Orders', icon: ShoppingCart },
    { id: 'rfqs', label: 'RFQs', icon: Send }
  ];

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-6">
            <button
              onClick={() => router.push('/suppliers')}
              className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] px-3 py-1.5 -ml-3 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors mb-4"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Suppliers
            </button>

            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Building2 className="h-8 w-8 text-blue-600" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                      {supplier.name || supplier.companyName}
                    </h1>
                    {getStatusBadge(supplier.status)}
                  </div>
                  {supplier.tradingName && (
                    <p className="text-sm text-[var(--ff-text-secondary)]">
                      Trading as: {supplier.tradingName}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {supplier.rating !== undefined && supplier.rating > 0 && (
                      <div className="flex items-center gap-1 text-yellow-500">
                        <Star className="h-4 w-4 fill-current" />
                        <span className="text-sm font-medium">{supplier.rating.toFixed(1)}</span>
                      </div>
                    )}
                    {supplier.businessType && (
                      <span className="text-sm text-gray-500">{supplier.businessType}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={() => router.push(`/procurement/rfq/new?supplierId=${id}`)}
                >
                  <Send className="h-4 w-4 mr-1" />
                  Send RFQ
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsEditing(!isEditing)}
                >
                  <Edit className="h-4 w-4 mr-1" />
                  {isEditing ? 'Cancel' : 'Edit'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="flex space-x-8">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                    className={`flex items-center gap-2 py-4 px-1 border-b-2 text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            {activeTab === 'profile' && (
              <div className="space-y-6">
                {isEditing ? (
                  // Edit Form
                  <div className="space-y-6">
                    {/* Basic Info */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Basic Information</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                          <input
                            type="text"
                            value={editForm.company_name || ''}
                            onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Trading Name</label>
                          <input
                            type="text"
                            value={editForm.trading_name || ''}
                            onChange={(e) => setEditForm({ ...editForm, trading_name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-1">Business Type</label>
                          <select
                            value={editForm.business_type || ''}
                            onChange={(e) => setEditForm({ ...editForm, business_type: e.target.value })}
                            className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
                          >
                            <option value="">Select type...</option>
                            <option value="Manufacturer">Manufacturer</option>
                            <option value="Distributor">Distributor</option>
                            <option value="Wholesaler">Wholesaler</option>
                            <option value="Retailer">Retailer</option>
                            <option value="Service Provider">Service Provider</option>
                            <option value="Contractor">Contractor</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-1">Status</label>
                          <select
                            value={editForm.status || 'pending'}
                            onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                            className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
                          >
                            <option value="active">Active</option>
                            <option value="approved">Approved</option>
                            <option value="pending">Pending</option>
                            <option value="inactive">Inactive</option>
                            <option value="suspended">Suspended</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Contact Info */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Contact Information</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                          <input
                            type="email"
                            value={editForm.email || ''}
                            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                          <input
                            type="tel"
                            value={editForm.phone || ''}
                            onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                          <input
                            type="url"
                            value={editForm.website || ''}
                            onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="https://"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                          <input
                            type="text"
                            value={editForm.contact_name || ''}
                            onChange={(e) => setEditForm({ ...editForm, contact_name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Address */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Address</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
                          <input
                            type="text"
                            value={editForm.physical_address || ''}
                            onChange={(e) => setEditForm({ ...editForm, physical_address: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                          <input
                            type="text"
                            value={editForm.city || ''}
                            onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Province</label>
                          <input
                            type="text"
                            value={editForm.province || ''}
                            onChange={(e) => setEditForm({ ...editForm, province: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Postal Code</label>
                          <input
                            type="text"
                            value={editForm.postal_code || ''}
                            onChange={(e) => setEditForm({ ...editForm, postal_code: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                          <input
                            type="text"
                            value={editForm.country || 'South Africa'}
                            onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Business Registration */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Business Registration</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Registration Number</label>
                          <input
                            type="text"
                            value={editForm.registration_number || ''}
                            onChange={(e) => setEditForm({ ...editForm, registration_number: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">VAT/Tax Number</label>
                          <input
                            type="text"
                            value={editForm.tax_number || ''}
                            onChange={(e) => setEditForm({ ...editForm, tax_number: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                      <textarea
                        value={editForm.notes || ''}
                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Additional notes about this supplier..."
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <Button variant="outline" onClick={() => { setIsEditing(false); if (supplier) setEditForm(transformForForm(supplier)); }}>
                        Cancel
                      </Button>
                      <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h3 className="font-semibold text-gray-900">Contact Information</h3>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 text-gray-600">
                          <Mail className="h-4 w-4 text-gray-400" />
                          <a href={`mailto:${supplier.email}`} className="hover:text-blue-600">
                            {supplier.email}
                          </a>
                        </div>
                        <div className="flex items-center gap-3 text-gray-600">
                          <Phone className="h-4 w-4 text-gray-400" />
                          <a href={`tel:${supplier.phone}`} className="hover:text-blue-600">
                            {supplier.phone}
                          </a>
                        </div>
                        {supplier.website && (
                          <div className="flex items-center gap-3 text-gray-600">
                            <Globe className="h-4 w-4 text-gray-400" />
                            <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600">
                              {supplier.website}
                            </a>
                          </div>
                        )}
                        {supplier.addresses?.physical?.street1 && (
                          <div className="flex items-start gap-3 text-gray-600">
                            <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                            <div>
                              <p>{supplier.addresses.physical.street1}</p>
                              <p>{[supplier.addresses.physical.city, supplier.addresses.physical.state, supplier.addresses.physical.postalCode].filter(Boolean).join(', ')}</p>
                              {supplier.addresses.physical.country && <p>{supplier.addresses.physical.country}</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="font-semibold text-gray-900">Business Details</h3>
                      <div className="space-y-2">
                        {supplier.registrationNumber && (
                          <div className="flex justify-between py-2 border-b border-gray-100">
                            <span className="text-gray-500">Registration No.</span>
                            <span className="font-medium">{supplier.registrationNumber}</span>
                          </div>
                        )}
                        {supplier.taxNumber && (
                          <div className="flex justify-between py-2 border-b border-gray-100">
                            <span className="text-gray-500">Tax Number</span>
                            <span className="font-medium">{supplier.taxNumber}</span>
                          </div>
                        )}
                        {supplier.businessType && (
                          <div className="flex justify-between py-2 border-b border-gray-100">
                            <span className="text-gray-500">Business Type</span>
                            <span className="font-medium">{supplier.businessType}</span>
                          </div>
                        )}
                        {supplier.createdAt && (
                          <div className="flex justify-between py-2 border-b border-gray-100">
                            <span className="text-gray-500">Added</span>
                            <span className="font-medium">
                              {new Date(supplier.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    {supplier.notes && (
                      <div className="md:col-span-2">
                        <h3 className="font-semibold text-gray-900 mb-2">Notes</h3>
                        <p className="text-gray-600 bg-gray-50 p-4 rounded-lg">{supplier.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'performance' && (
              <div className="text-center py-12 text-gray-500">
                <BarChart3 className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Performance Metrics</h3>
                <p>Performance tracking and ratings will be displayed here.</p>
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="text-center py-12 text-gray-500">
                <FileText className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Documents</h3>
                <p>Compliance documents, certificates, and contracts will be displayed here.</p>
              </div>
            )}

            {activeTab === 'orders' && (
              <div>
                {purchaseOrders.length > 0 ? (
                  <div className="space-y-4">
                    {purchaseOrders.map((po) => (
                      <div key={po.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">{po.po_number}</p>
                          <p className="text-sm text-gray-500">
                            {new Date(po.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">R {po.total_amount?.toLocaleString()}</p>
                          <span className="text-sm text-gray-500">{po.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <ShoppingCart className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Orders Yet</h3>
                    <p>Purchase orders with this supplier will appear here.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'rfqs' && (
              <div>
                {rfqInvites.length > 0 ? (
                  <div className="space-y-4">
                    {rfqInvites.map((rfq) => (
                      <div
                        key={rfq.id}
                        className="flex items-center justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100"
                        onClick={() => router.push(`/procurement/rfq/${rfq.id}`)}
                      >
                        <div>
                          <p className="font-medium text-gray-900">{rfq.title}</p>
                          <p className="text-sm text-gray-500">{rfq.rfq_number}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm">Due: {new Date(rfq.response_deadline).toLocaleDateString()}</p>
                          <span className="text-sm text-gray-500">{rfq.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <Send className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No RFQ Invites</h3>
                    <p>RFQ invitations sent to this supplier will appear here.</p>
                    <Button
                      className="mt-4"
                      onClick={() => router.push('/procurement/rfq/new')}
                    >
                      Create RFQ
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Delete Confirmation Dialog */}
          {showDeleteDialog && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-md mx-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Delete Supplier</h3>
                <p className="text-gray-600 mb-6">
                  How would you like to remove this supplier?
                </p>
                <div className="space-y-3">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleDelete(true)}
                  >
                    Deactivate (Keep Records)
                  </Button>
                  <Button
                    className="w-full bg-red-600 hover:bg-red-700"
                    onClick={() => handleDelete(false)}
                  >
                    Permanently Delete
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowDeleteDialog(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
