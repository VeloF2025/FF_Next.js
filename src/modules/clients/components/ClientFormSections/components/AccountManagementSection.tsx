import { useState, useEffect } from 'react';
import { SectionProps } from '../types/clientForm.types';

interface StaffMember {
  id: string;
  name: string;
  position?: string;
  department?: string;
}

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-primary)] mb-1";

export function AccountManagementSection({ formData, handleInputChange }: SectionProps) {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    fetch('/api/staff?status=active')
      .then(r => r.json())
      .then(json => {
        const data = json.data || json;
        setStaffList(Array.isArray(data) ? data : []);
      })
      .catch(() => setStaffList([]))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Account Management</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Sales Representative</label>
          <select
            value={formData.salesRepresentativeId || ''}
            onChange={(e) => handleInputChange('salesRepresentativeId', e.target.value || undefined)}
            className={inputClasses}
            disabled={isLoading}
          >
            <option value="">— None —</option>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.position ? ` (${s.position})` : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            Responsible for client sales relationship
          </p>
        </div>

        <div>
          <label className={labelClasses}>Account Manager</label>
          <select
            value={formData.accountManagerId || ''}
            onChange={(e) => handleInputChange('accountManagerId', e.target.value || undefined)}
            className={inputClasses}
            disabled={isLoading}
          >
            <option value="">— None —</option>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.position ? ` (${s.position})` : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            Responsible for account receivable management
          </p>
        </div>
      </div>
    </div>
  );
}
