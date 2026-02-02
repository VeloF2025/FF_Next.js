import { SectionProps, PaymentTerms, CreditRating } from '../types/clientForm.types';

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-primary)] mb-1";

export function FinancialSection({ formData, handleInputChange }: SectionProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Financial Information</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>
            Credit Limit (ZAR)
          </label>
          <input
            type="number"
            value={formData.creditLimit}
            onChange={(e) => handleInputChange('creditLimit', Number(e.target.value))}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Payment Terms
          </label>
          <select
            value={formData.paymentTerms}
            onChange={(e) => handleInputChange('paymentTerms', e.target.value as PaymentTerms)}
            className={inputClasses}
          >
            {Object.values(PaymentTerms).map(term => (
              <option key={term} value={term}>
                {term.replace(/_/g, ' ').toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClasses}>
            Credit Rating
          </label>
          <select
            value={formData.creditRating}
            onChange={(e) => handleInputChange('creditRating', e.target.value as CreditRating)}
            className={inputClasses}
          >
            {Object.values(CreditRating).map(rating => (
              <option key={rating} value={rating}>
                {rating.charAt(0).toUpperCase() + rating.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}