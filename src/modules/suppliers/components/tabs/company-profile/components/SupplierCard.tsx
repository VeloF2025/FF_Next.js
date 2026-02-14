// ============= Supplier Card Component =============
// Card component for supplier display in grid or list view

import React from 'react';
import { Building2, MapPin, Mail, Globe, Star, Eye, Edit } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExtendedSupplier, ViewMode } from '../types/company-profile.types';
import { getStatusConfig } from '../data/statusConfig';

interface SupplierCardProps {
  supplier: ExtendedSupplier;
  isSelected: boolean;
  onSelect: () => void;
  viewMode: ViewMode;
}

export const SupplierCard: React.FC<SupplierCardProps> = ({
  supplier,
  isSelected,
  onSelect,
  viewMode
}) => {
  const status = getStatusConfig(supplier.status);
  const StatusIcon = status.icon;

  // List view
  if (viewMode === 'list') {
    return (
      <div
        className={cn(
          "bg-card border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md",
          isSelected ? "border-blue-500 ring-2 ring-blue-200" : "border-border"
        )}
        onClick={onSelect}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{supplier.name}</h3>
              <p className="text-sm text-muted-foreground">{supplier.code} • {supplier.category}</p>
              <div className="flex items-center space-x-4 mt-1">
                <span className="flex items-center text-sm text-muted-foreground">
                  <MapPin className="w-3 h-3 mr-1" />
                  {supplier.location}
                </span>
                <span className="flex items-center text-sm text-muted-foreground">
                  <Mail className="w-3 h-3 mr-1" />
                  {supplier.contactPerson}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <div className="flex items-center space-x-1">
                <Star className="w-4 h-4 text-yellow-500 fill-current" />
                <span className="font-medium">{supplier.rating}</span>
              </div>
              <p className="text-xs text-muted-foreground">{supplier.complianceScore}% compliance</p>
            </div>
            <div className={cn("px-2 py-1 rounded-full flex items-center space-x-1", status.bgColor)}>
              <StatusIcon className={cn("w-3 h-3", status.color)} />
              <span className={cn("text-xs font-medium", status.color)}>{status.label}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Grid view
  return (
    <div
      className={cn(
        "bg-card border rounded-lg p-6 cursor-pointer transition-all hover:shadow-md",
        isSelected ? "border-blue-500 ring-2 ring-blue-200" : "border-border"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-14 h-14 bg-blue-100 rounded-lg flex items-center justify-center">
          <Building2 className="w-7 h-7 text-blue-600" />
        </div>
        <div className={cn("px-2 py-1 rounded-full flex items-center space-x-1", status.bgColor)}>
          <StatusIcon className={cn("w-3 h-3", status.color)} />
          <span className={cn("text-xs font-medium", status.color)}>{status.label}</span>
        </div>
      </div>

      <div className="mb-4">
        <h3 className="font-semibold text-foreground mb-1">{supplier.name}</h3>
        <p className="text-sm text-muted-foreground mb-2">{supplier.code}</p>
        <p className="text-xs text-muted-foreground line-clamp-2">{supplier.description}</p>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center text-sm text-muted-foreground">
          <MapPin className="w-3 h-3 mr-2 text-gray-400" />
          {supplier.location}
        </div>
        <div className="flex items-center text-sm text-muted-foreground">
          <Mail className="w-3 h-3 mr-2 text-gray-400" />
          {supplier.contactPerson}
        </div>
        <div className="flex items-center text-sm text-muted-foreground">
          <Globe className="w-3 h-3 mr-2 text-gray-400" />
          {supplier.category}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t">
        <div className="flex items-center space-x-1">
          <Star className="w-4 h-4 text-yellow-500 fill-current" />
          <span className="font-medium text-sm">{supplier.rating}</span>
          <span className="text-xs text-muted-foreground">({supplier.complianceScore}% compliance)</span>
        </div>
        <div className="flex space-x-1">
          <button
            onClick={(e) => { e.stopPropagation(); }}
            className="p-1 text-gray-400 hover:text-muted-foreground"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); }}
            className="p-1 text-gray-400 hover:text-muted-foreground"
          >
            <Edit className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
