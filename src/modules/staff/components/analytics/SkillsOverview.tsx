/**
 * Skills Overview Component
 * Displays top skills in the workforce as badges
 */

import { formatLabel } from '@/lib/utils';

interface Skill {
  skill: string;
  count: number;
}

interface SkillsOverviewProps {
  topSkills: Skill[];
}

export function SkillsOverview({ topSkills }: SkillsOverviewProps) {
  if (!topSkills || topSkills.length === 0) {
    return null;
  }

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Top Skills in Workforce</h3>
      <div className="flex flex-wrap gap-2">
        {topSkills.map((skill) => (
          <span
            key={skill.skill}
            className="px-3 py-1 text-sm font-medium bg-blue-500/20 text-blue-400 rounded-full"
          >
            {formatLabel(skill.skill)} ({skill.count})
          </span>
        ))}
      </div>
    </div>
  );
}