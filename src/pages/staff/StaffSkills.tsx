/**
 * Staff Skills Form Section
 */

import { StaffFormData, Skill } from '@/types/staff.types';

interface StaffSkillsProps {
  formData: StaffFormData;
  onSkillToggle: (skill: Skill) => void;
}

export function StaffSkills({ formData, onSkillToggle }: StaffSkillsProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-foreground mb-4">Skills</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.values(Skill).map(skill => (
          <label key={skill} className="flex items-center">
            <input
              type="checkbox"
              checked={formData.skills.includes(skill)}
              onChange={() => onSkillToggle(skill)}
              className="mr-2"
            />
            <span className="text-sm">
              {skill.replace(/_/g, ' ').charAt(0).toUpperCase() + skill.slice(1)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}