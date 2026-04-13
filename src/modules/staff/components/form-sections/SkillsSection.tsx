import { StaffFormData, Skill } from '@/types/staff.types';
import { formatLabel } from '@/lib/utils';

interface SkillsSectionProps {
  formData: StaffFormData;
  handleInputChange: (field: keyof StaffFormData, value: StaffFormData[keyof StaffFormData]) => void;
  toggleSkill?: (skill: Skill) => void;
}

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-[var(--ff-text-secondary)]";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-secondary)] mb-1";

export function SkillsSection({ formData, toggleSkill, handleInputChange }: SkillsSectionProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Skills & Certifications</h2>
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
          Technical Skills
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.values(Skill).map(skill => (
            <label key={skill} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.skills.includes(skill)}
                onChange={() => toggleSkill?.(skill)}
                className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)]"
              />
              <span className="text-sm text-[var(--ff-text-secondary)]">
                {formatLabel(skill)}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label className={labelClasses}>
          Specializations (comma-separated)
        </label>
        <input
          type="text"
          value={(formData.specializations || []).join(', ')}
          onChange={(e) => handleInputChange('specializations', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder="e.g., GPON, Aerial Installation, Splicing"
          className={inputClasses}
        />
      </div>

      <div className="mt-4">
        <label className={labelClasses}>
          Notes
        </label>
        <textarea
          value={formData.notes || ''}
          onChange={(e) => handleInputChange('notes', e.target.value)}
          rows={3}
          className={inputClasses}
        />
      </div>
    </div>
  );
}
