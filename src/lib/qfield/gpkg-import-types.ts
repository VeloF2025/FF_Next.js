/**
 * GeoJSON and GPKG import type definitions.
 * Replaces `any[]` with properly typed feature objects.
 */

/**
 * GeoJSON Geometry types
 */
export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: Array<[number, number]>;
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: Array<Array<[number, number]>>;
}

export type GeoJSONGeometry = GeoJSONPoint | GeoJSONLineString | GeoJSONPolygon;

/**
 * Base GeoJSON Feature with generic properties
 */
export interface GeoJSONFeature<T = Record<string, unknown>> {
  type: 'Feature';
  geometry?: GeoJSONGeometry | null;
  properties: T;
}

/**
 * Pole feature properties
 */
export interface PoleProperties {
  pole_number: string;
  type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  dome_joint?: string | null;
  type_of_join?: string | null;
  splitter?: string | null;
  slack_on_pole?: string | null;
  field_agent?: string | null;
  pole_planted?: string | null;
  audit_complete?: string | null;
  zone_no?: string | number | null;
  pon_no?: string | number | null;
  geojson?: GeoJSONGeometry | null;
}

export type PoleFeature = GeoJSONFeature<PoleProperties>;

/**
 * Joint feature properties
 */
export interface JointProperties {
  joint_label: string;
  joint_type?: string | null;
  cable_capacity?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  pon_no?: string | number | null;
  zone_no?: string | number | null;
  geojson?: GeoJSONGeometry | null;
}

export type JointFeature = GeoJSONFeature<JointProperties>;

/**
 * Drop feature properties
 */
export interface DropProperties {
  drop_number: string;
  pole_number?: string | null;
  cable_capacity?: string | null;
  pon_no?: string | number | null;
  zone_no?: string | number | null;
  latitude?: number | null;
  longitude?: number | null;
  geojson?: GeoJSONGeometry | null;
}

export type DropFeature = GeoJSONFeature<DropProperties>;

/**
 * Cable span feature properties
 */
export interface CableSpanProperties {
  span_label: string;
  cable_size?: string | null;
  span_type?: string | null;
  pon_no?: string | number | null;
  zone_no?: string | number | null;
  length_meters?: number | null;
  geojson?: GeoJSONGeometry | null;
}

export type CableSpanFeature = GeoJSONFeature<CableSpanProperties>;

/**
 * Zone boundary feature properties
 */
export interface ZoneBoundaryProperties {
  zone_no: string | number;
  geojson: GeoJSONGeometry;
}

export type ZoneBoundaryFeature = GeoJSONFeature<ZoneBoundaryProperties>;

/**
 * PON boundary feature properties
 */
export interface PonBoundaryProperties {
  pon_no: string | number;
  zone_no?: string | number | null;
  pon_label?: string | null;
  geojson: GeoJSONGeometry;
}

export type PonBoundaryFeature = GeoJSONFeature<PonBoundaryProperties>;

/**
 * POP feature properties
 */
export interface PopProperties {
  pop_label?: string | null;
  geojson: GeoJSONGeometry;
}

export type PopFeature = GeoJSONFeature<PopProperties>;

/**
 * Union type for all import features
 */
export type ImportFeature = 
  | PoleFeature 
  | JointFeature 
  | DropFeature 
  | CableSpanFeature 
  | ZoneBoundaryFeature 
  | PonBoundaryFeature 
  | PopFeature;
