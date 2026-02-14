/**
 * Staff Job Information Form Section
 */

import { 
  StaffFormData, 
  Department, 
  Position,
  StaffStatus, 
  ContractType 
} from '@/types/staff.types';

interface StaffJobInfoProps {
  formData: StaffFormData;
  onInputChange: (field: keyof StaffFormData, value: any) => void;
}

export function StaffJobInfo({ formData, onInputChange }: StaffJobInfoProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-foreground mb-4">Job Information</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Position
          </label>
          <select
            value={formData.position}
            onChange={(e) => onInputChange('position', e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.values(Position).map(pos => (
              <option key={pos} value={pos}>
                {pos}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Department
          </label>
          <select
            value={formData.department}
            onChange={(e) => onInputChange('department', e.target.value as Department)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.values(Department).map(dept => (
              <option key={dept} value={dept}>
                {dept.replace('_', ' ').charAt(0).toUpperCase() + dept.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Status
          </label>
          <select
            value={formData.status}
            onChange={(e) => onInputChange('status', e.target.value as StaffStatus)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.values(StaffStatus).map(status => (
              <option key={status} value={status}>
                {status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Contract Type
          </label>
          <select
            value={formData.contractType}
            onChange={(e) => onInputChange('contractType', e.target.value as ContractType)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.values(ContractType).map(type => (
              <option key={type} value={type}>
                {type.replace('_', ' ').charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Max Projects
          </label>
          <input
            type="number"
            min="1"
            value={formData.maxProjectCount}
            onChange={(e) => onInputChange('maxProjectCount', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}