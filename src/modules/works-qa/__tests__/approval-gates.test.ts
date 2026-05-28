import { describe, it, expect } from 'vitest';
import { allGatesPass, disciplineGatesPass } from '../utils/approval-gates';
import type { PoleQaPhoto } from '../types/works-qa.types';

const FULL_POLE: PoleQaPhoto = {
  id: 'test-id',
  project_id: 'proj-id',
  pole_label: 'A673',
  zone_no: 1,
  pon_no: 1,
  civil_step_01_key: 'works-qa/proj/A673/civil/01.jpg',
  civil_step_02_key: 'works-qa/proj/A673/civil/02.jpg',
  civil_step_03_key: 'works-qa/proj/A673/civil/03.jpg',
  civil_step_04_key: 'works-qa/proj/A673/civil/04.jpg',
  civil_step_05_key: 'works-qa/proj/A673/civil/05.jpg',
  civil_step_06_key: 'works-qa/proj/A673/civil/06.jpg',
  civil_step_07_key: 'works-qa/proj/A673/civil/07.jpg',
  civil_step_08_key: 'works-qa/proj/A673/civil/08.jpg',
  optical_dome_01_key: 'works-qa/proj/A673/optical/dome_01.jpg',
  optical_dome_02_key: 'works-qa/proj/A673/optical/dome_02.jpg',
  optical_dome_03_key: 'works-qa/proj/A673/optical/dome_03.jpg',
  optical_dome_04_key: 'works-qa/proj/A673/optical/dome_04.jpg',
  optical_dome_05_key: 'works-qa/proj/A673/optical/dome_05.jpg',
  optical_dome_06_key: 'works-qa/proj/A673/optical/dome_06.jpg',
  optical_dome_07_key: 'works-qa/proj/A673/optical/dome_07.jpg',
  optical_dome_08_key: 'works-qa/proj/A673/optical/dome_08.jpg',
  main_joint_11_key: 'works-qa/proj/A673/optical/joint_11.jpg',
  main_joint_12_key: 'works-qa/proj/A673/optical/joint_12.jpg',
  main_joint_13_key: 'works-qa/proj/A673/optical/joint_13.jpg',
  main_joint_14_key: 'works-qa/proj/A673/optical/joint_14.jpg',
  main_joint_15_key: 'works-qa/proj/A673/optical/joint_15.jpg',
  main_joint_16_key: 'works-qa/proj/A673/optical/joint_16.jpg',
  main_joint_tray_keys: ['works-qa/proj/A673/optical/tray_01.jpg'],
  vlm_results: {
    civil_01: { valid: true, confidence: 0.92, feedback: 'OK' },
    civil_02: { valid: true, confidence: 0.88, feedback: 'OK' },
    civil_03: { valid: true, confidence: 0.91, feedback: 'OK' },
    civil_04: { valid: true, confidence: 0.85, feedback: 'OK' },
    civil_05: { valid: true, confidence: 0.90, feedback: 'OK' },
    civil_06: { valid: true, confidence: 0.87, feedback: 'OK' },
    civil_07: { valid: true, confidence: 0.93, feedback: 'OK' },
    civil_08: { valid: true, confidence: 0.90, feedback: 'OK' },
    dome_01: { valid: true, confidence: 0.89, feedback: 'OK' },
    dome_02: { valid: true, confidence: 0.91, feedback: 'OK' },
    dome_03: { valid: true, confidence: 0.88, feedback: 'OK' },
    dome_04: { valid: true, confidence: 0.90, feedback: 'OK' },
    dome_05: { valid: true, confidence: 0.87, feedback: 'OK' },
    dome_06: { valid: true, confidence: 0.92, feedback: 'OK' },
    dome_07: { valid: true, confidence: 0.86, feedback: 'OK' },
    dome_08: { valid: true, confidence: 0.94, feedback: 'OK' },
    main_joint_11: { valid: true, confidence: 0.88, feedback: 'OK' },
    main_joint_12: { valid: true, confidence: 0.89, feedback: 'OK' },
    main_joint_13: { valid: true, confidence: 0.91, feedback: 'OK' },
    main_joint_14: { valid: true, confidence: 0.87, feedback: 'OK' },
    main_joint_15: { valid: true, confidence: 0.90, feedback: 'OK' },
    main_joint_16: { valid: true, confidence: 0.88, feedback: 'OK' },
  },
  civil_approved: false,
  dome_approved: false,
  joint_approved: false,
  approved_by: null,
  approved_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('allGatesPass', () => {
  it('passes when all 22 slots filled, all VLM valid, ≥1 tray photo', () => {
    const result = allGatesPass(FULL_POLE);
    expect(result.pass).toBe(true);
    expect(result.blocking).toHaveLength(0);
  });

  it('blocks when a fixed slot is missing', () => {
    const pole = { ...FULL_POLE, civil_step_03_key: null };
    const result = allGatesPass(pole);
    expect(result.pass).toBe(false);
    expect(result.blocking).toContain('civil_03');
  });

  it('blocks when VLM failed and no override', () => {
    const pole = {
      ...FULL_POLE,
      vlm_results: {
        ...FULL_POLE.vlm_results,
        dome_02: { valid: false, confidence: 0.31, feedback: 'Not a dome label' },
      },
    };
    const result = allGatesPass(pole);
    expect(result.pass).toBe(false);
    expect(result.blocking).toContain('dome_02');
  });

  it('allows overridden VLM failure', () => {
    const pole = {
      ...FULL_POLE,
      vlm_results: {
        ...FULL_POLE.vlm_results,
        dome_02: { valid: false, confidence: 0.31, feedback: 'Not a dome label', overridden_by: 'Johan' },
      },
    };
    const result = allGatesPass(pole);
    expect(result.pass).toBe(true);
  });

  it('blocks when no tray photos', () => {
    const pole = { ...FULL_POLE, main_joint_tray_keys: [] };
    const result = allGatesPass(pole);
    expect(result.pass).toBe(false);
    expect(result.blocking).toContain('tray_photos');
  });
});

describe('disciplineGatesPass', () => {
  it('fails civil gate when a slot has slot_approvals.decision === "snagged" even if VLM passes', () => {
    const pole = {
      ...FULL_POLE,
      slot_approvals: {
        civil_01: {
          decision: 'snagged',
          by: 'user-1',
          at: '2026-05-19T12:00:00Z',
          snag_id: 'snag-abc',
        },
      },
    };
    const result = disciplineGatesPass(pole, 'civil');
    expect(result.pass).toBe(false);
    expect(result.blocking).toContain('civil_01');
  });

  it('blocks civil gate when the Pole Label (civil_08) photo is missing', () => {
    const pole = { ...FULL_POLE, civil_step_08_key: null };
    const result = disciplineGatesPass(pole, 'civil');
    expect(result.pass).toBe(false);
    expect(result.blocking).toContain('civil_08');
  });

  it('passes civil gate when reviewed slot has decision "approved" and other slots pass VLM', () => {
    const pole = {
      ...FULL_POLE,
      slot_approvals: {
        civil_01: {
          decision: 'approved',
          by: 'user-1',
          at: '2026-05-19T12:00:00Z',
        },
      },
    };
    const result = disciplineGatesPass(pole, 'civil');
    expect(result.pass).toBe(true);
    expect(result.blocking).toHaveLength(0);
  });
});
