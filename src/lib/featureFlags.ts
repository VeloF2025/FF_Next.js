/**
 * Feature Flags for Gradual Rollout
 *
 * Controls which features are enabled for specific projects/users
 * during phased deployment.
 */

export type Project = 'Velo Test' | 'Lawley' | 'Mohadin' | 'Mamelodi' | string;

export type FeatureFlag = {
  name: string;
  description: string;
  enabled: boolean;
  enabledProjects?: Project[];
  rolloutStage: 'disabled' | 'pilot' | 'partial' | 'full';
};

/**
 * Feature flags configuration
 */
export const FEATURE_FLAGS: Record<string, FeatureFlag> = {
  UNIFIED_DR_REVIEW: {
    name: 'Unified DR Photo Review',
    description: 'Consolidated DR photo review system (Phase 6 rollout)',
    enabled: true,
    enabledProjects: [], // Week 6.4: Full rollout - empty array = all projects
    rolloutStage: 'full',
  },

  // Future feature flags can be added here
  AUTO_DOWNLOAD_PHOTOS: {
    name: 'Auto-Download Photos on WhatsApp Message',
    description: 'Automatically fetch photos when new WhatsApp message detected',
    enabled: false,
    enabledProjects: [],
    rolloutStage: 'disabled',
  },
};

/**
 * Check if unified DR review is enabled for a specific project
 *
 * @param project - Project name (e.g., 'Velo Test', 'Lawley')
 * @returns true if unified review should be shown, false to use old system
 */
export function isUnifiedReviewEnabled(project: string): boolean {
  const flag = FEATURE_FLAGS.UNIFIED_DR_REVIEW!;

  if (!flag.enabled) {
    return false;
  }

  // If no specific projects listed, enable for all (full rollout)
  if (!flag.enabledProjects || flag.enabledProjects.length === 0) {
    return true;
  }

  // Check if project is in enabled list
  return flag.enabledProjects.includes(project);
}

/**
 * Get current rollout stage for unified review
 */
export function getUnifiedReviewRolloutStage(): FeatureFlag['rolloutStage'] {
  return FEATURE_FLAGS.UNIFIED_DR_REVIEW!.rolloutStage;
}

/**
 * Update feature flag (for programmatic rollout progression)
 *
 * @param flagName - Feature flag key
 * @param updates - Partial updates to apply
 */
export function updateFeatureFlag(
  flagName: keyof typeof FEATURE_FLAGS,
  updates: Partial<FeatureFlag>
): void {
  FEATURE_FLAGS[flagName] = {
    ...FEATURE_FLAGS[flagName],
    ...updates,
  } as FeatureFlag;
}

/**
 * Rollout progression helper
 * Week 6.1: Pilot (Velo Test only)
 * Week 6.3: Partial (Velo Test + Lawley + Mohadin + Mamelodi)
 * Week 6.4: Full (all projects)
 */
export function progressRollout(week: '6.1' | '6.3' | '6.4'): void {
  switch (week) {
    case '6.1':
      // Week 6.1: Pilot with Velo Test
      updateFeatureFlag('UNIFIED_DR_REVIEW', {
        enabledProjects: ['Velo Test'],
        rolloutStage: 'pilot',
      });
      break;

    case '6.3':
      // Week 6.3: Expand to all main projects
      updateFeatureFlag('UNIFIED_DR_REVIEW', {
        enabledProjects: ['Velo Test', 'Lawley', 'Mohadin', 'Mamelodi'],
        rolloutStage: 'partial',
      });
      break;

    case '6.4':
      // Week 6.4: Full rollout to all projects
      updateFeatureFlag('UNIFIED_DR_REVIEW', {
        enabledProjects: [], // Empty = all projects
        rolloutStage: 'full',
      });
      break;
  }
}

/**
 * Get list of projects currently enabled for unified review
 */
export function getEnabledProjects(): Project[] {
  const flag = FEATURE_FLAGS.UNIFIED_DR_REVIEW!;

  if (!flag.enabled) {
    return [];
  }

  if (!flag.enabledProjects || flag.enabledProjects.length === 0) {
    return ['All Projects'];
  }

  return flag.enabledProjects;
}
