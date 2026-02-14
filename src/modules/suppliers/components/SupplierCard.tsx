import { useRouter } from 'next/router';
import {
  Building2, Mail, Phone, MapPin, Star, TrendingUp,
  AlertCircle, CheckCircle, Clock, XCircle, MoreVertical
} from 'lucide-react';
import { Supplier, SupplierStatus } from '@/types/supplier.types';

interface SupplierCardProps {
  supplier: Supplier;
}

export function SupplierCard({ supplier }: SupplierCardProps) {
  const router = useRouter();

  const handleClick = () => {
    router.push(`/suppliers/${supplier.id}`);
  };

  const getStatusIcon = () => {
    switch (supplier.status) {
      case SupplierStatus.ACTIVE:
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case SupplierStatus.INACTIVE:
        return <XCircle className="h-4 w-4 text-gray-500 dark:text-gray-400" />;
      case SupplierStatus.PENDING:
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case SupplierStatus.SUSPENDED:
        return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case SupplierStatus.BLACKLISTED:
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusColor = () => {
    switch (supplier.status) {
      case SupplierStatus.ACTIVE:
        return 'bg-green-500/20 text-green-400';
      case SupplierStatus.INACTIVE:
        return 'bg-gray-500/20 text-gray-400';
      case SupplierStatus.PENDING:
        return 'bg-yellow-500/20 text-yellow-400';
      case SupplierStatus.SUSPENDED:
        return 'bg-orange-500/20 text-orange-400';
      case SupplierStatus.BLACKLISTED:
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const renderRating = () => {
    const rating = typeof supplier.rating === 'number' 
      ? supplier.rating 
      : supplier.rating.overall;
    const totalReviews = typeof supplier.rating === 'object' 
      ? supplier.rating.totalReviews || 0
      : 0;
    
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-3 w-3 ${
              star <= Math.round(rating)
                ? 'text-yellow-400 fill-current'
                : 'text-[var(--ff-text-tertiary)]'
            }`}
          />
        ))}
        <span className="text-xs text-[var(--ff-text-secondary)] ml-1">
          ({totalReviews})
        </span>
      </div>
    );
  };

  return (
    <div
      onClick={handleClick}
      className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)] hover:shadow-lg transition-shadow cursor-pointer"
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {getStatusIcon()}
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor()}`}>
              {supplier.status}
            </span>
            {supplier.isPreferred && (
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 flex items-center gap-1">
                <Star className="h-3 w-3" />
                Preferred
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{supplier.companyName || supplier.name}</h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">Reg: {supplier.registrationNo || supplier.registrationNumber}</p>
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

      {/* Contact Info */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center text-sm text-[var(--ff-text-secondary)]">
          <Building2 className="h-4 w-4 mr-2 text-[var(--ff-text-tertiary)]" />
          <span>{supplier.businessType}</span>
        </div>
        <div className="flex items-center text-sm text-[var(--ff-text-secondary)]">
          <Mail className="h-4 w-4 mr-2 text-[var(--ff-text-tertiary)]" />
          <span className="truncate">{supplier.primaryContact?.email || supplier.email}</span>
        </div>
        <div className="flex items-center text-sm text-[var(--ff-text-secondary)]">
          <Phone className="h-4 w-4 mr-2 text-[var(--ff-text-tertiary)]" />
          <span>{supplier.primaryContact?.phone || supplier.phone}</span>
        </div>
        <div className="flex items-center text-sm text-[var(--ff-text-secondary)]">
          <MapPin className="h-4 w-4 mr-2 text-[var(--ff-text-tertiary)]" />
          <span>{supplier.addresses?.physical?.city || 'N/A'}, {supplier.addresses?.physical?.state || 'N/A'}</span>
        </div>
      </div>

      {/* Categories */}
      <div className="mb-4">
        <div className="flex flex-wrap gap-1">
          {supplier.categories.slice(0, 3).map((category) => (
            <span
              key={category}
              className="px-2 py-1 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-xs rounded"
            >
              {category.replace(/_/g, ' ')}
            </span>
          ))}
          {supplier.categories.length > 3 && (
            <span className="px-2 py-1 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-xs rounded">
              +{supplier.categories.length - 3} more
            </span>
          )}
        </div>
      </div>

      {/* Performance */}
      <div className="border-t border-[var(--ff-border-light)] pt-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[var(--ff-text-secondary)]">Rating</p>
            {renderRating()}
          </div>
          <div>
            <p className="text-xs text-[var(--ff-text-secondary)]">Performance</p>
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-green-400" />
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                {supplier.performance?.overallScore || 0}%
              </span>
            </div>
          </div>
        </div>

        {/* Compliance Status */}
        <div className="mt-3 flex items-center gap-2">
          {supplier.complianceStatus?.taxCompliant && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              Tax
            </span>
          )}
          {supplier.complianceStatus?.isoCompliant && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              ISO
            </span>
          )}
          {supplier.complianceStatus?.beeLevel && (
            <span className="text-xs text-blue-400">
              BBBEE L{supplier.complianceStatus.beeLevel}
            </span>
          )}
        </div>
      </div>

      {/* Active Indicators */}
      {(supplier.performance?.metrics?.totalOrders) && (
        <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)] flex justify-between text-xs text-[var(--ff-text-secondary)]">
          <span>{supplier.performance.metrics.totalOrders} total orders</span>
          {supplier.performance.metrics.completedOrders > 0 && (
            <span>{supplier.performance.metrics.completedOrders} completed</span>
          )}
        </div>
      )}
    </div>
  );
}