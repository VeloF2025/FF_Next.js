import { describe, it, expect } from 'vitest';
import { classifyVehicle } from '../classify';
import { DEFAULT_THRESHOLDS, type VehicleDwellSample } from '../types';

const LAWLEY = '4eb13426-b2a1-472d-9b3c-277082ae9b55';
const POP1 = '7d8b94d6-8e5a-4dbb-9ede-69ce3884e004';
const MAMELODI = '7003dc06-9af7-4a7c-bc6c-a177d77784f2';

function share(projectId: string, projectName: string, dwellSeconds: number, pings: number, distinctDays: number) {
  return { projectId, projectName, dwellSeconds, pings, distinctDays };
}

function sample(shares: VehicleDwellSample['shares'], totalPositions = 10_000): VehicleDwellSample {
  return { vehicleId: 'v1', registration: 'MW94RBGP', totalPositions, shares };
}

describe('classifyVehicle', () => {
  it('calls a single-project vehicle confident', () => {
    const result = classifyVehicle(sample([share(LAWLEY, 'Lawley', 1_193_000, 61_798, 34)]), DEFAULT_THRESHOLDS);
    expect(result.outcome).toBe('confident');
    expect(result.inferredProjectId).toBe(LAWLEY);
    expect(result.dominantShare).toBe(1);
  });

  it('calls a dominant-but-mixed vehicle confident on the dominant project', () => {
    // MW94RBGP measured 2026-08-21: Lawley 83.9%, Themb'elihle 12.9%, POP1 2.8%.
    const result = classifyVehicle(sample([
      share(LAWLEY, 'Lawley', 330_480, 19_646, 22),
      share(MAMELODI, "Themb'elihle", 50_760, 2_198, 15),
      share(POP1, 'Thembisa POP 1', 11_160, 643, 22),
    ]), DEFAULT_THRESHOLDS);
    expect(result.outcome).toBe('confident');
    expect(result.inferredProjectId).toBe(LAWLEY);
    expect(result.dominantShare).toBeCloseTo(0.842, 2);
  });

  it('calls a vehicle just under the threshold roaming, and names no project', () => {
    // MW67LZGP measured 2026-08-21: Lawley 67.8% - the closest real vehicle to
    // the 70% line. It must NOT be assigned to Lawley.
    const result = classifyVehicle(sample([
      share(LAWLEY, 'Lawley', 249_120, 8_254, 21),
      share(POP1, 'Thembisa POP 1', 102_960, 3_565, 27),
      share(MAMELODI, 'Mamelodi', 15_120, 503, 14),
    ]), DEFAULT_THRESHOLDS);
    expect(result.outcome).toBe('roaming');
    expect(result.inferredProjectId).toBeNull();
    expect(result.dominantShare).toBeCloseTo(0.678, 2);
  });

  it('reports insufficient_data when the sample is too small, even if one project holds 100%', () => {
    const result = classifyVehicle(sample([share(LAWLEY, 'Lawley', 3_600, 40, 12)], 115), DEFAULT_THRESHOLDS);
    expect(result.outcome).toBe('insufficient_data');
    expect(result.inferredProjectId).toBeNull();
    // The share is still reported - the human needs to see why we abstained.
    expect(result.dominantShare).toBe(1);
  });

  it('reports insufficient_data when pings are plentiful but spread over too few days', () => {
    const result = classifyVehicle(sample([share(LAWLEY, 'Lawley', 90_000, 5_000, 2)]), DEFAULT_THRESHOLDS);
    expect(result.outcome).toBe('insufficient_data');
    expect(result.inferredProjectId).toBeNull();
  });

  it('reports no_aoi_coverage when the vehicle reported positions but none inside an AOI', () => {
    // KN74ZSGP measured 2026-08-21: 274 positions, zero AOI hits.
    const result = classifyVehicle(sample([], 274), DEFAULT_THRESHOLDS);
    expect(result.outcome).toBe('no_aoi_coverage');
    expect(result.inferredProjectId).toBeNull();
    expect(result.dominantShare).toBeNull();
  });

  it('reports insufficient_data for a vehicle with no positions at all', () => {
    const result = classifyVehicle(sample([], 0), DEFAULT_THRESHOLDS);
    expect(result.outcome).toBe('insufficient_data');
    expect(result.dominantShare).toBeNull();
    expect(result.pings).toBe(0);
  });

  it('is inclusive at exactly the confident threshold', () => {
    const result = classifyVehicle(sample([
      share(LAWLEY, 'Lawley', 700, 700, 10),
      share(POP1, 'Thembisa POP 1', 300, 300, 10),
    ]), DEFAULT_THRESHOLDS);
    expect(result.dominantShare).toBe(0.7);
    expect(result.outcome).toBe('confident');
  });

  it('applies the day minimum to the dominant project, not the vehicle total', () => {
    // 30 days of evidence overall, but the dominant project was visited twice.
    const result = classifyVehicle(sample([
      share(LAWLEY, 'Lawley', 8_000, 800, 2),
      share(POP1, 'Thembisa POP 1', 2_000, 200, 28),
    ]), DEFAULT_THRESHOLDS);
    expect(result.outcome).toBe('insufficient_data');
  });

  it('ranks by dwell seconds, not by ping count', () => {
    // Ping-share would pick POP1 (more pings while driving); dwell picks Lawley.
    const result = classifyVehicle(sample([
      share(LAWLEY, 'Lawley', 80_000, 400, 20),
      share(POP1, 'Thembisa POP 1', 20_000, 9_000, 20),
    ]), DEFAULT_THRESHOLDS);
    expect(result.inferredProjectId).toBe(LAWLEY);
    expect(result.outcome).toBe('confident');
  });

  it('orders the breakdown by descending share and shares sum to one', () => {
    const result = classifyVehicle(sample([
      share(POP1, 'Thembisa POP 1', 100, 10, 5),
      share(LAWLEY, 'Lawley', 900, 90, 5),
    ]), DEFAULT_THRESHOLDS);
    expect(result.breakdown.map((entry) => entry.projectId)).toEqual([LAWLEY, POP1]);
    expect(result.breakdown.reduce((total, entry) => total + entry.share, 0)).toBeCloseTo(1, 10);
  });
});
