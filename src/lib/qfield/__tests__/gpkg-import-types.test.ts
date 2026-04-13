/**
 * Type safety tests for gpkg-import modules
 * Verifies that feature types are properly constrained
 */

import type {
  PoleProperties,
  PoleFeature,
  JointProperties,
  DropProperties,
  CableSpanProperties,
  ZoneBoundaryProperties,
  PonBoundaryProperties,
  PopProperties,
} from '../gpkg-import-types';

/**
 * Test: PoleProperties type narrowing
 * This should compile without errors
 */
const testPoleProperties: PoleProperties = {
  pole_number: 'P-001',
  type: 'wooden',
  latitude: -26.2041,
  longitude: 28.0473,
  dome_joint: 'DJ-001',
  type_of_join: 'fusion',
  splitter: 'Corning',
  slack_on_pole: '2m',
  field_agent: 'Agent Smith',
  pole_planted: '2024-01-15',
  audit_complete: '2024-02-01',
  zone_no: 5,
  pon_no: 12,
};

/**
 * Test: PoleFeature with full GeoJSON
 */
const _testPoleFeature: PoleFeature = {
  type: 'Feature',
  geometry: {
    type: 'Point',
    coordinates: [-26.2041, 28.0473],
  },
  properties: testPoleProperties,
};

/**
 * Test: JointProperties type
 */
const testJointProperties: JointProperties = {
  joint_label: 'J-001',
  joint_type: 'splice',
  cable_capacity: '96 fibers',
  latitude: -26.2045,
  longitude: 28.0475,
  pon_no: '12',
  zone_no: 5,
};

/**
 * Test: DropProperties type
 */
const testDropProperties: DropProperties = {
  drop_number: 'D-001',
  pole_number: 'P-001',
  cable_capacity: '2 fibers',
  pon_no: 12,
  zone_no: 5,
  latitude: -26.2042,
  longitude: 28.0474,
};

/**
 * Test: CableSpanProperties type
 */
const testCableSpanProperties: CableSpanProperties = {
  span_label: 'S-001',
  cable_size: '96 fiber',
  span_type: 'underground',
  pon_no: 12,
  zone_no: 5,
  length_meters: 500,
};

/**
 * Test: ZoneBoundaryProperties type
 */
const testZoneBoundaryProperties: ZoneBoundaryProperties = {
  zone_no: 5,
  geojson: {
    type: 'Polygon',
    coordinates: [
      [
        [-26.2, 28.0],
        [-26.21, 28.0],
        [-26.21, 28.01],
        [-26.2, 28.01],
        [-26.2, 28.0],
      ],
    ],
  },
};

/**
 * Test: PonBoundaryProperties type
 */
const testPonBoundaryProperties: PonBoundaryProperties = {
  pon_no: 12,
  zone_no: 5,
  pon_label: 'PON-12',
  geojson: {
    type: 'Polygon',
    coordinates: [
      [
        [-26.2, 28.0],
        [-26.21, 28.0],
        [-26.21, 28.01],
        [-26.2, 28.01],
        [-26.2, 28.0],
      ],
    ],
  },
};

/**
 * Test: PopProperties type
 */
const testPopProperties: PopProperties = {
  pop_label: 'POP-01',
  geojson: {
    type: 'Point',
    coordinates: [-26.205, 28.005],
  },
};

/**
 * Test: Array types for import functions
 * These represent data that would be passed to the import functions
 */
const polePropertiesArray: PoleProperties[] = [
  testPoleProperties,
  {
    pole_number: 'P-002',
    type: 'concrete',
    latitude: -26.2043,
    longitude: 28.0476,
  },
];

const jointPropertiesArray: JointProperties[] = [testJointProperties];
const dropPropertiesArray: DropProperties[] = [testDropProperties];
const cableSpanPropertiesArray: CableSpanProperties[] = [
  testCableSpanProperties,
];
const zoneBoundaryPropertiesArray: ZoneBoundaryProperties[] = [
  testZoneBoundaryProperties,
];
const ponBoundaryPropertiesArray: PonBoundaryProperties[] = [
  testPonBoundaryProperties,
];
const popPropertiesArray: PopProperties[] = [testPopProperties];

/**
 * Verify arrays compile without type errors
 * (This is a compile-time test, not a runtime test)
 */
export const typeTests = {
  polePropertiesArray,
  jointPropertiesArray,
  dropPropertiesArray,
  cableSpanPropertiesArray,
  zoneBoundaryPropertiesArray,
  ponBoundaryPropertiesArray,
  popPropertiesArray,
};
