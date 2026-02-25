import React from 'react';
import { ChevronDown, ChevronRight, Eye, Edit, MapPin, Phone, Clock, User, Package } from 'lucide-react';
import { HomeInstall } from '../types/home-install.types';
import { cn } from '@/src/utils/cn';
import { formatDisplayDate } from '@/utils/dateFormat';

interface HomeInstallsTableProps {
  installs: HomeInstall[];
  expandedRows: Set<string>;
  onToggleRow: (id: string) => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
}

export function HomeInstallsTable({
  installs,
  expandedRows,
  onToggleRow,
  onView,
  onEdit,
}: HomeInstallsTableProps) {
  const getStatusColor = (status: HomeInstall['status']) => {
    switch (status) {
      case 'scheduled':
        return 'bg-info-500/20 text-info-400 border-info-500/30';
      case 'in_progress':
        return 'bg-warning-500/20 text-warning-400 border-warning-500/30';
      case 'completed':
        return 'bg-success-500/20 text-success-400 border-success-500/30';
      case 'cancelled':
        return 'bg-error-500/20 text-error-400 border-error-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const formatDate = (date: string | Date) => formatDisplayDate(date);


  if (installs.length === 0) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-8">
        <div className="text-center">
          <Package className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
          <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-1">No installations found</h3>
          <p className="text-[var(--ff-text-secondary)]">Try adjusting your search or filter criteria</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Order
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Address
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Schedule
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Package
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Technician
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
            {installs.map((install) => (
              <React.Fragment key={install.id}>
                <tr className="hover:bg-[var(--ff-bg-hover)] transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <button
                        onClick={() => onToggleRow(install.id)}
                        className="mr-2 p-1 hover:bg-[var(--ff-bg-hover)] rounded"
                      >
                        {expandedRows.has(install.id) ? (
                          <ChevronDown className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                        )}
                      </button>
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {install.orderNumber}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <div className="text-sm font-medium text-[var(--ff-text-primary)]">{install.customerName}</div>
                      {install.alternatePhone && (
                        <div className="text-sm text-[var(--ff-text-secondary)]">{install.alternatePhone}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-[var(--ff-text-primary)]">{install.address}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-[var(--ff-text-primary)]">{formatDate(install.scheduledDate)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={cn(
                        'px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border',
                        getStatusColor(install.status)
                      )}
                    >
                      {install.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-[var(--ff-text-primary)]">{install.packageType}</div>
                    <div className="text-sm text-[var(--ff-text-secondary)]">{install.speed} Mbps</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-[var(--ff-text-primary)]">
                      {install.assignedTechnician || 'Not assigned'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => onView(install.id)}
                      className="text-primary-600 hover:text-primary-700 mr-3"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onEdit(install.id)}
                      className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                
                {expandedRows.has(install.id) && (
                  <tr>
                    <td colSpan={8} className="px-6 py-4 bg-[var(--ff-bg-tertiary)]">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <h4 className="font-medium text-[var(--ff-text-primary)]">Customer Details</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
                              <User className="h-4 w-4" />
                              <span>{install.customerId}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
                              <Phone className="h-4 w-4" />
                              <span>{install.alternatePhone || 'No alternate phone'}</span>
                            </div>
                            <div className="flex items-start gap-2 text-[var(--ff-text-secondary)]">
                              <MapPin className="h-4 w-4 mt-0.5" />
                              <span>{install.coordinates ? `${install.coordinates.latitude}, ${install.coordinates.longitude}` : 'No coordinates'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <h4 className="font-medium text-[var(--ff-text-primary)]">Installation Details</h4>
                          <div className="space-y-1 text-sm text-[var(--ff-text-secondary)]">
                            <div>ONT Serial: {install.ontSerial || 'Not assigned'}</div>
                            <div>Router Serial: {install.routerSerial || 'Not assigned'}</div>
                            <div>Cable Length: {install.cableLength || 0}m</div>
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4" />
                              <span>Est. Duration: {install.estimatedDuration || 2} hours</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <h4 className="font-medium text-[var(--ff-text-primary)]">Notes</h4>
                          <p className="text-sm text-[var(--ff-text-secondary)]">
                            {install.notes || 'No additional notes'}
                          </p>
                          {install.specialRequirements && (
                            <div className="mt-2">
                              <span className="text-sm font-medium text-[var(--ff-text-primary)]">Special Requirements:</span>
                              <p className="text-sm text-[var(--ff-text-secondary)]">{install.specialRequirements}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}