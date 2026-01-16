/**
 * DR Photo Unified - Rollout Progression Script
 *
 * Phase 6: Progress through rollout stages
 *
 * Usage:
 *   npx tsx scripts/activate/progress-rollout.ts 6.1  # Pilot (Velo Test)
 *   npx tsx scripts/activate/progress-rollout.ts 6.3  # Partial (4 projects)
 *   npx tsx scripts/activate/progress-rollout.ts 6.4  # Full (all projects)
 */

import { progressRollout, getEnabledProjects, getUnifiedReviewRolloutStage } from '../../src/lib/featureFlags';

const args = process.argv.slice(2);
const week = args[0] as '6.1' | '6.3' | '6.4';

if (!week || !['6.1', '6.3', '6.4'].includes(week)) {
  console.error('❌ Invalid week. Usage: npx tsx scripts/activate/progress-rollout.ts [6.1|6.3|6.4]');
  process.exit(1);
}

console.log(`\n🚀 Progressing DR Photo Unified Rollout to Week ${week}...\n`);

// Current state
console.log('📊 Current State:');
console.log(`   Stage: ${getUnifiedReviewRolloutStage()}`);
console.log(`   Enabled Projects: ${getEnabledProjects().join(', ')}\n`);

// Progress to new stage
progressRollout(week);

// New state
console.log('✅ Updated State:');
console.log(`   Stage: ${getUnifiedReviewRolloutStage()}`);
console.log(`   Enabled Projects: ${getEnabledProjects().join(', ')}\n`);

// Instructions
console.log('📝 Next Steps:');
if (week === '6.1') {
  console.log('   1. Monitor Velo Test project for 1 week');
  console.log('   2. Track metrics at /activate/monitoring');
  console.log('   3. Gather user feedback');
  console.log('   4. If stable, progress to Week 6.3\n');
} else if (week === '6.3') {
  console.log('   1. Announce rollout to Lawley, Mohadin, Mamelodi');
  console.log('   2. Monitor metrics for all 4 projects');
  console.log('   3. Verify no performance degradation');
  console.log('   4. If stable, progress to Week 6.4\n');
} else if (week === '6.4') {
  console.log('   1. Unified review enabled for ALL projects');
  console.log('   2. Mark old services as deprecated');
  console.log('   3. Schedule port 8003 shutdown (2 weeks backup)');
  console.log('   4. Update documentation\n');
}

console.log('⚠️  Note: This only updates the feature flag in memory.');
console.log('   To persist changes, update src/lib/featureFlags.ts manually.\n');
