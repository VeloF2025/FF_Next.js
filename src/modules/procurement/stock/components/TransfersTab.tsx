import React from 'react';
import { ArrowLeft, Package } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import type { StockMovementData } from '../types/stock.types';

interface TransfersTabProps {
  transfers: StockMovementData[];
  onCreateTransfer: () => void;
}

export const TransfersTab: React.FC<TransfersTabProps> = ({ transfers, onCreateTransfer }) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Stock Transfers</h3>
        <Button onClick={onCreateTransfer}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Create Transfer
        </Button>
      </div>

      {transfers.length > 0 ? (
        <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {transfers.map((transfer) => (
              <div key={transfer.id} className="p-6 bg-white hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-semibold text-gray-900">{transfer.reference}</h4>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        transfer.status === 'completed' ? 'bg-green-100 text-green-800' :
                        transfer.status === 'in-progress' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {transfer.status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    </div>
                    <p className="text-gray-700 mb-2">{transfer.itemDescription}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-gray-600">
                      <div>
                        <p className="text-xs text-gray-500">Quantity</p>
                        <p className="font-medium">{transfer.quantity.toLocaleString()} {transfer.unit}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">From</p>
                        <p className="font-medium">{transfer.fromLocation || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">To</p>
                        <p className="font-medium">{transfer.toLocation || 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm">
                    View Details
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No transfers found</h3>
          <p className="text-gray-500 mb-4">
            Create a transfer to move stock between locations.
          </p>
          <Button onClick={onCreateTransfer}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Create First Transfer
          </Button>
        </div>
      )}
    </div>
  );
};
