/**
 * Client Financial Section Component
 */

import { CreditCard, TrendingUp } from 'lucide-react';
import { Client } from '@/types/client.types';

interface ClientFinancialSectionProps {
  client: Client;
  getCreditRatingColor: (rating: string) => string;
  formatCurrency: (amount: number) => string;
}

export function ClientFinancialSection({ 
  client, 
  getCreditRatingColor, 
  formatCurrency 
}: ClientFinancialSectionProps) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Financial Information</h2>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Credit Limit</label>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {formatCurrency(client.creditLimit || 0)}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Credit Rating</label>
            <p className={`mt-1 text-lg font-semibold ${getCreditRatingColor(client.creditRating || '')}`}>
              <CreditCard className="inline h-5 w-5 mr-1" />
              {client.creditRating || 'Not rated'}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Total Revenue</label>
            <p className="mt-1 text-lg font-semibold text-foreground">
              <TrendingUp className="inline h-5 w-5 mr-1 text-green-600" />
              {formatCurrency(client.totalRevenue || 0)}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Outstanding Balance</label>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {formatCurrency(client.outstandingBalance || 0)}
            </p>
          </div>
        </div>

        {client.paymentTerms && (
          <div className="pt-4 border-t border-border">
            <label className="text-sm font-medium text-muted-foreground">Payment Terms</label>
            <p className="mt-1 text-foreground">{client.paymentTerms}</p>
          </div>
        )}

        {client.taxNumber && (
          <div>
            <label className="text-sm font-medium text-muted-foreground">Tax Number</label>
            <p className="mt-1 text-foreground">{client.taxNumber}</p>
          </div>
        )}

        {client.registrationNumber && (
          <div>
            <label className="text-sm font-medium text-muted-foreground">Registration Number</label>
            <p className="mt-1 text-foreground">{client.registrationNumber}</p>
          </div>
        )}
      </div>
    </div>
  );
}