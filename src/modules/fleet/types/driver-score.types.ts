/**
 * Fleet Driver Score Types
 * Types for driver performance tracking, scorecards, and leaderboards
 */

// ============================================================================
// Score Period Types
// ============================================================================

export type ScorePeriod = 'daily' | 'weekly' | 'monthly';

// ============================================================================
// Driver Score Types
// ============================================================================

export interface DriverScore {
  id: string;
  staffId: string;
  scoreDate: string;
  scoreType: ScorePeriod;

  // Individual scores (0-100)
  checkInCompliance: number | null;
  fuelEfficiencyScore: number | null;
  authorizationCompliance: number | null;
  vehicleCareScore: number | null;

  // Composite score (25% each)
  compositeScore: number | null;

  // Check-in metrics
  totalCheckIns: number;
  expectedCheckIns: number;
  missedCheckIns: number;
  lateCheckIns: number;
  criticalIssuesReported: number;
  minorIssuesReported: number;

  // Fuel metrics
  avgLitresPer100km: number | null;
  fleetAvgLitresPer100km: number | null;
  totalFuelCost: number | null;

  // Authorization metrics (from GPS)
  totalTrips: number;
  authorizedTrips: number;
  unauthorizedTrips: number;
  afterHoursTrips: number;
  weekendTrips: number;
  totalKm: number;
  unauthorizedKm: number;

  createdAt: string;
}

export interface DriverScoreWithDetails extends DriverScore {
  driverName: string;
  driverPhone: string | null;
  driverEmail: string | null;
  rank: number;
}

// ============================================================================
// Leaderboard Types
// ============================================================================

export interface LeaderboardEntry {
  rank: number;
  staffId: string;
  driverName: string;
  driverPhone: string | null;
  driverEmail: string | null;
  scoreDate: string;
  scoreType: ScorePeriod;

  // Scores
  checkInCompliance: number | null;
  fuelEfficiencyScore: number | null;
  authorizationCompliance: number | null;
  vehicleCareScore: number | null;
  compositeScore: number | null;

  // Key metrics
  totalCheckIns: number;
  expectedCheckIns: number;
  totalTrips: number;
  unauthorizedTrips: number;
  avgLitresPer100km: number | null;
  fleetAvgLitresPer100km: number | null;
}

export interface Leaderboard {
  period: ScorePeriod;
  scoreDate: string;
  generatedAt: string;
  totalDrivers: number;
  entries: LeaderboardEntry[];
}

// ============================================================================
// Driver Scorecard Types
// ============================================================================

export interface DriverScorecard {
  staffId: string;
  driverName: string;
  driverPhone: string | null;
  driverEmail: string | null;

  // Current scores
  currentScore: DriverScore | null;
  currentRank: number | null;
  totalDrivers: number;

  // Score history
  scoreHistory: DriverScoreHistoryPoint[];

  // Score breakdown
  breakdown: {
    checkIn: ScoreBreakdown;
    fuelEfficiency: ScoreBreakdown;
    authorization: ScoreBreakdown;
    vehicleCare: ScoreBreakdown;
  };

  // Assigned vehicle info
  assignedVehicle: {
    vehicleId: string;
    registration: string;
    make: string | null;
    model: string | null;
    assignedDate: string;
  } | null;

  // Achievements/badges
  achievements: DriverAchievement[];
}

export interface DriverScoreHistoryPoint {
  scoreDate: string;
  scoreType: ScorePeriod;
  compositeScore: number | null;
  checkInCompliance: number | null;
  fuelEfficiencyScore: number | null;
  authorizationCompliance: number | null;
  vehicleCareScore: number | null;
  rank: number | null;
}

export interface ScoreBreakdown {
  score: number | null;
  label: string;
  description: string;
  metrics: Record<string, number | string | null>;
  trend: 'up' | 'down' | 'flat' | null;
  trendValue: number | null;
}

export interface DriverAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: string;
  category: 'compliance' | 'efficiency' | 'safety' | 'streak';
}

// ============================================================================
// Compliance Types
// ============================================================================

export interface DriverCompliance {
  staffId: string;
  driverName: string;
  vehicleId: string;
  registration: string;
  daysAssigned: number;
  assignedDate: string;
  returnedDate: string | null;

  // Check-in stats
  totalChecks: number;
  checks30d: number;
  checks7d: number;
  criticalIssues: number;
  minorIssues: number;
  approvedChecks: number;
  rejectedChecks: number;
  lastCheckDate: string | null;

  // Calculated
  complianceRate: number;
  daysSinceLastCheck: number | null;
}

// ============================================================================
// API Request Types
// ============================================================================

export interface GetDriverScoresRequest {
  period?: ScorePeriod;
  staffId?: string;
  limit?: number;
  offset?: number;
}

export interface GetLeaderboardRequest {
  period?: ScorePeriod;
  limit?: number;
}

export interface GetDriverScorecardRequest {
  staffId: string;
  period?: ScorePeriod;
  historyMonths?: number;
}

export interface CalculateDriverScoresRequest {
  period: ScorePeriod;
  date?: string; // Default: today
}

// ============================================================================
// Database Row Types
// ============================================================================

export interface DriverScoreRow {
  id: string;
  staff_id: string;
  score_date: string;
  score_type: string;
  check_in_compliance: string | null;
  fuel_efficiency_score: string | null;
  authorization_compliance: string | null;
  vehicle_care_score: string | null;
  composite_score: string | null;
  total_check_ins: number;
  expected_check_ins: number;
  missed_check_ins: number;
  late_check_ins: number;
  critical_issues_reported: number;
  minor_issues_reported: number;
  avg_litres_per_100km: string | null;
  fleet_avg_litres_per_100km: string | null;
  total_fuel_cost: string | null;
  total_trips: number;
  authorized_trips: number;
  unauthorized_trips: number;
  after_hours_trips: number;
  weekend_trips: number;
  total_km: string;
  unauthorized_km: string;
  created_at: string;
}

export interface LeaderboardRow extends DriverScoreRow {
  driver_name: string;
  phone: string | null;
  email: string | null;
  rank: number;
}

export interface DriverComplianceRow {
  staff_id: string;
  driver_name: string;
  driver_phone: string | null;
  driver_email: string | null;
  vehicle_id: string;
  registration: string;
  days_assigned: number;
  assigned_date: string;
  returned_date: string | null;
  total_checks: number;
  checks_30d: number;
  checks_7d: number;
  critical_issues: number;
  minor_issues: number;
  approved_checks: number;
  rejected_checks: number;
  last_check_date: string | null;
  compliance_rate: string;
  days_since_last_check: number | null;
}

// ============================================================================
// Row Converters
// ============================================================================

export function rowToDriverScore(row: DriverScoreRow): DriverScore {
  return {
    id: row.id,
    staffId: row.staff_id,
    scoreDate: row.score_date,
    scoreType: row.score_type as ScorePeriod,
    checkInCompliance: row.check_in_compliance ? parseFloat(row.check_in_compliance) : null,
    fuelEfficiencyScore: row.fuel_efficiency_score ? parseFloat(row.fuel_efficiency_score) : null,
    authorizationCompliance: row.authorization_compliance ? parseFloat(row.authorization_compliance) : null,
    vehicleCareScore: row.vehicle_care_score ? parseFloat(row.vehicle_care_score) : null,
    compositeScore: row.composite_score ? parseFloat(row.composite_score) : null,
    totalCheckIns: row.total_check_ins,
    expectedCheckIns: row.expected_check_ins,
    missedCheckIns: row.missed_check_ins,
    lateCheckIns: row.late_check_ins,
    criticalIssuesReported: row.critical_issues_reported,
    minorIssuesReported: row.minor_issues_reported,
    avgLitresPer100km: row.avg_litres_per_100km ? parseFloat(row.avg_litres_per_100km) : null,
    fleetAvgLitresPer100km: row.fleet_avg_litres_per_100km ? parseFloat(row.fleet_avg_litres_per_100km) : null,
    totalFuelCost: row.total_fuel_cost ? parseFloat(row.total_fuel_cost) : null,
    totalTrips: row.total_trips,
    authorizedTrips: row.authorized_trips,
    unauthorizedTrips: row.unauthorized_trips,
    afterHoursTrips: row.after_hours_trips,
    weekendTrips: row.weekend_trips,
    totalKm: parseFloat(row.total_km) || 0,
    unauthorizedKm: parseFloat(row.unauthorized_km) || 0,
    createdAt: row.created_at,
  };
}

export function rowToLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    rank: row.rank,
    staffId: row.staff_id,
    driverName: row.driver_name,
    driverPhone: row.phone,
    driverEmail: row.email,
    scoreDate: row.score_date,
    scoreType: row.score_type as ScorePeriod,
    checkInCompliance: row.check_in_compliance ? parseFloat(row.check_in_compliance) : null,
    fuelEfficiencyScore: row.fuel_efficiency_score ? parseFloat(row.fuel_efficiency_score) : null,
    authorizationCompliance: row.authorization_compliance ? parseFloat(row.authorization_compliance) : null,
    vehicleCareScore: row.vehicle_care_score ? parseFloat(row.vehicle_care_score) : null,
    compositeScore: row.composite_score ? parseFloat(row.composite_score) : null,
    totalCheckIns: row.total_check_ins,
    expectedCheckIns: row.expected_check_ins,
    totalTrips: row.total_trips,
    unauthorizedTrips: row.unauthorized_trips,
    avgLitresPer100km: row.avg_litres_per_100km ? parseFloat(row.avg_litres_per_100km) : null,
    fleetAvgLitresPer100km: row.fleet_avg_litres_per_100km ? parseFloat(row.fleet_avg_litres_per_100km) : null,
  };
}

export function rowToDriverCompliance(row: DriverComplianceRow): DriverCompliance {
  return {
    staffId: row.staff_id,
    driverName: row.driver_name,
    vehicleId: row.vehicle_id,
    registration: row.registration,
    daysAssigned: row.days_assigned,
    assignedDate: row.assigned_date,
    returnedDate: row.returned_date,
    totalChecks: row.total_checks,
    checks30d: row.checks_30d,
    checks7d: row.checks_7d,
    criticalIssues: row.critical_issues,
    minorIssues: row.minor_issues,
    approvedChecks: row.approved_checks,
    rejectedChecks: row.rejected_checks,
    lastCheckDate: row.last_check_date,
    complianceRate: parseFloat(row.compliance_rate) || 0,
    daysSinceLastCheck: row.days_since_last_check,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

export function getScoreColor(score: number | null): string {
  if (score === null) return 'text-gray-400';
  if (score >= 90) return 'text-green-600 dark:text-green-400';
  if (score >= 70) return 'text-yellow-600 dark:text-yellow-400';
  if (score >= 50) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

export function getScoreLabel(score: number | null): string {
  if (score === null) return 'N/A';
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Fair';
  return 'Needs Improvement';
}

export function getRankBadge(rank: number): { label: string; color: string; icon: string } {
  if (rank === 1) return { label: 'Gold', color: 'text-yellow-500', icon: '🥇' };
  if (rank === 2) return { label: 'Silver', color: 'text-gray-400', icon: '🥈' };
  if (rank === 3) return { label: 'Bronze', color: 'text-orange-500', icon: '🥉' };
  if (rank <= 10) return { label: 'Top 10', color: 'text-blue-500', icon: '⭐' };
  return { label: `#${rank}`, color: 'text-gray-500 dark:text-gray-400', icon: '' };
}

/**
 * Calculate composite score from individual scores
 * Uses equal weights: 25% each
 */
export function calculateCompositeScore(
  checkIn: number | null,
  fuelEfficiency: number | null,
  authorization: number | null,
  vehicleCare: number | null
): number | null {
  const scores = [checkIn, fuelEfficiency, authorization, vehicleCare].filter(
    (s): s is number => s !== null
  );

  if (scores.length === 0) return null;

  // If we have all 4 scores, use equal weights
  if (scores.length === 4) {
    return (checkIn! + fuelEfficiency! + authorization! + vehicleCare!) / 4;
  }

  // If some scores are missing, average available scores
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
