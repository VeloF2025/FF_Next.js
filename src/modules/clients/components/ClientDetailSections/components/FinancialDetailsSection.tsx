
import type { SectionProps } from '../types/clientSection.types';
import { formatCurrency, getCreditRatingColor, formatTextUppercase } from '../utils/displayUtils';

export function FinancialDetailsSection({ client }: SectionProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Financial Information</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Credit Limit</p>
          <p className="font-medium text-lg text-[var(--ff-text-primary)]">{formatCurrency(client.creditLimit)}</p>
        </div>

        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Current Balance</p>
          <p className="font-medium text-lg text-[var(--ff-text-primary)]">{formatCurrency(client.currentBalance)}</p>
        </div>

        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Payment Terms</p>
          <p className="font-medium text-[var(--ff-text-primary)]">{formatTextUppercase(client.paymentTerms)}</p>
        </div>

        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Credit Rating</p>
          <p className={`font-medium ${getCreditRatingColor(client.creditRating)}`}>
            {client.creditRating.charAt(0).toUpperCase() + client.creditRating.slice(1)}
          </p>
        </div>
      </div>
    </div>
  );
}