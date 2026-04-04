// ============= Supplier Detail Panel Component =============
// Detailed view panel for selected supplier

import React from 'react';
import { Building2, Mail, Phone, Globe, MapPin, Star, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ExtendedSupplier } from '../types/company-profile.types';
import { getStatusConfig } from '../data/statusConfig';

interface SupplierDetailPanelProps {
  supplier: ExtendedSupplier | null;
}

export const SupplierDetailPanel: React.FC<SupplierDetailPanelProps> = ({ supplier }) => {
  if (!supplier) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <Building2 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Select a Supplier</h3>
          <p className="text-muted-foreground">Choose a supplier from the list to view detailed information.</p>
        </div>
      </div>
    );
  }

  const status = getStatusConfig(supplier.status);
  const StatusIcon = status.icon;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold">{supplier.name}</h2>
            <p className="text-blue-100 mt-1">{supplier.code} • {supplier.category}</p>
            <p className="text-blue-100 text-sm mt-2">{supplier.description}</p>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-right">
              <div className="flex items-center space-x-1 justify-end">
                <Star className="w-5 h-5 text-yellow-300 fill-current" />
                <span className="font-semibold text-lg">{supplier.rating}</span>
              </div>
              <p className="text-blue-100 text-sm">{supplier.complianceScore}% compliance</p>
            </div>
            <div className="bg-card bg-opacity-20 px-3 py-1 rounded-full flex items-center space-x-2">
              <StatusIcon className="w-4 h-4" />
              <span className="text-sm font-medium">{status.label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Contact Information */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Contact Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center space-x-3">
              <Mail className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{supplier.email}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Phone className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <p className="font-medium">{supplier.phone}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Globe className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-muted-foreground">Website</p>
                <a href={`https://${supplier.website}`} className="font-medium text-blue-600 hover:text-blue-700">
                  {supplier.website}
                </a>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <MapPin className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-muted-foreground">Address</p>
                <p className="font-medium">{supplier.address}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Company Details */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Company Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Contact Person</p>
              <p className="font-medium">{supplier.contactPerson}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Year Established</p>
              <p className="font-medium">{supplier.yearEstablished}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Employee Count</p>
              <p className="font-medium">{supplier.employeeCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Annual Revenue</p>
              <p className="font-medium">{supplier.annualRevenue}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Payment Terms</p>
              <p className="font-medium">{supplier.paymentTerms}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Delivery Regions</p>
              <p className="font-medium">{supplier.deliveryRegions.join(', ')}</p>
            </div>
          </div>
        </div>

        {/* Business Sectors */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Business Sectors</h3>
          <div className="flex flex-wrap gap-2">
            {supplier.businessSector.map((sector, index) => (
              <span key={index} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                {sector}
              </span>
            ))}
          </div>
        </div>

        {/* Certifications */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Certifications</h3>
          <div className="flex flex-wrap gap-2">
            {supplier.certifications.map((cert, index) => (
              <span key={index} className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">
                <CheckCircle className="w-3 h-3 inline mr-1" />
                {cert}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-background px-6 py-4 flex space-x-3">
        <Button className="flex-1">Select Supplier</Button>
        <Button variant="secondary">Edit Profile</Button>
        <Button variant="secondary">Send Message</Button>
      </div>
    </div>
  );
};
