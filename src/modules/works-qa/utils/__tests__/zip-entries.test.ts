import { poleToZipEntries, slotFilename, safeSegment } from '../zip-entries';
import type { PoleQaPhoto } from '../../types/works-qa.types';

const BASE: PoleQaPhoto = {
  id: 'p1', project_id: 'proj-1', pole_label: 'TEST.P.A001', zone_no: 5, pon_no: 999,
  civil_step_01_key: null, civil_step_02_key: null, civil_step_03_key: null, civil_step_04_key: null,
  civil_step_05_key: null, civil_step_06_key: null,
  civil_step_07_key: 'works-qa/proj-1/TEST.P.A001/civil/civil_07_1.jpg', civil_step_08_key: null,
  optical_dome_01_key: null, optical_dome_02_key: null, optical_dome_03_key: null, optical_dome_04_key: null,
  optical_dome_05_key: null, optical_dome_06_key: null, optical_dome_07_key: null, optical_dome_08_key: null,
  main_joint_11_key: null, main_joint_12_key: null, main_joint_13_key: null, main_joint_14_key: null,
  main_joint_15_key: null, main_joint_16_key: null,
  main_joint_tray_keys: [], unassigned_photo_keys: [],
  vlm_results: {}, civil_approved: false, dome_approved: false, joint_approved: false,
  approved_by: null, approved_at: null, override_reason: null, overridden_by: null, overridden_at: null,
  created_at: '', updated_at: '',
};

describe('slotFilename', () => {
  it('zero-pads the step and slugifies the label', () => {
    expect(slotFilename(7, 'After Photo')).toBe('07_after_photo.jpg');
  });
});

describe('safeSegment', () => {
  it('preserves ordinary pole labels', () => {
    expect(safeSegment('LAW.P.A001')).toBe('LAW.P.A001');
  });
  it('neutralises path separators and traversal', () => {
    expect(safeSegment('../../etc/passwd')).not.toMatch(/\.\.|[/\\]/);
    expect(safeSegment('a/b\\c')).toBe('a_b_c');
  });
});

describe('poleToZipEntries', () => {
  it('places a civil photo under {prefix}/{pole}/civil', () => {
    const entries = poleToZipEntries(BASE, 'Zone_5/PON_999');
    expect(entries).toContainEqual({
      path: 'Zone_5/PON_999/TEST.P.A001/civil/07_after_photo.jpg',
      storageKey: 'works-qa/proj-1/TEST.P.A001/civil/civil_07_1.jpg',
    });
  });

  it('places tray + unassigned photos under optical/ and unassigned/', () => {
    const pole: PoleQaPhoto = {
      ...BASE,
      main_joint_tray_keys: ['k/tray1.jpg'],
      unassigned_photo_keys: ['k/u1.jpg', 'k/u2.jpg'],
    };
    const paths = poleToZipEntries(pole, 'Zone_5/PON_999').map(e => e.path);
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/optical/tray_01.jpg');
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/unassigned/photo_01.jpg');
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/unassigned/photo_02.jpg');
  });

  it('emits no unassigned entries when the pole has none', () => {
    const paths = poleToZipEntries(BASE, 'Zone_5/PON_999').map(e => e.path);
    expect(paths.some(p => p.includes('/unassigned/'))).toBe(false);
  });

  it('never emits a traversal path from a hostile pole_label (Zip Slip)', () => {
    const pole: PoleQaPhoto = { ...BASE, pole_label: '../../evil' };
    for (const { path } of poleToZipEntries(pole, 'Zone_5/PON_999')) {
      expect(path.startsWith('Zone_5/PON_999/')).toBe(true);
      expect(path.split('/').includes('..')).toBe(false);
    }
  });
});
