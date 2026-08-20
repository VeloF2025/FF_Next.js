import type { Geometry } from 'geojson';
import { useEffect, useRef } from 'react';
import type { LatLng, LeafletEvent, PathOptions } from 'leaflet';
import { Circle, CircleMarker, GeoJSON, Marker, Popup, useMap } from 'react-leaflet';
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';
import type {
  OperationalAttendancePoint,
  OperationalBadgeRow,
  OperationalOverlayGeometry,
} from '../operations/mapOverlayService';
import type { OperationalMapDisplayOverlay } from '../operations/web/mapOverlayFilters';
import { partitionVehicles } from '../utils/liveMapHelpers';
import { createOperationalBadgeIcon, operationalBadgeStyle } from './operationalMapStyles';
export interface OperationalMapLayersProps {
  operationalOverlay: OperationalMapDisplayOverlay;
  vehicles: LiveVehicle[];
  selectedStaffId?: string | null;
  onStaffSelect?: (staffId: string) => void;
  focusStaffId?: string | null;
  focusRequestId?: number;
}
interface FocusLayer { getLatLng: () => LatLng; openPopup: () => unknown }
type RegisterLayer = (staffId: string, layer: FocusLayer | null) => void;
function layerHandlers(staffId: string, onStaffSelect: ((staffId: string) => void) | undefined,
  register: RegisterLayer) {
  return {
    ...(onStaffSelect ? { click: () => onStaffSelect(staffId) } : {}),
    add: (event: LeafletEvent) => register(staffId, event.target as FocusLayer),
    remove: () => register(staffId, null),
  };
}
function OperationalBadgeMarker({ badge, vehicle, selected, onStaffSelect, register }: {
  badge: OperationalBadgeRow;
  vehicle: LiveVehicle & { lat: number; lon: number };
  selected: boolean;
  onStaffSelect?: (staffId: string) => void;
  register: RegisterLayer;
}) {
  const style = operationalBadgeStyle(badge.status);
  const label = `${badge.staffName} — ${style.label} operational status`;
  return (
    <Marker
      alt={label}
      eventHandlers={layerHandlers(badge.staffId, onStaffSelect, register)}
      icon={createOperationalBadgeIcon(badge.status, selected)}
      position={[vehicle.lat, vehicle.lon]}
      title={label}
    >
      <Popup>
        <strong>{badge.staffName}</strong>
        <br />
        <span className="sr-only">Operational status: </span>{style.label}
        <br />
        {badge.operationalSiteName ?? badge.projectName ?? 'No operational site assigned'}
      </Popup>
    </Marker>
  );
}
function AttendanceMarker({ point, selected, onStaffSelect, register }: {
  point: OperationalAttendancePoint;
  selected: boolean;
  onStaffSelect?: (staffId: string) => void;
  register: RegisterLayer;
}) {
  const selectedClass = selected ? ' fleet-map-attendance-marker--selected' : '';
  return (
    <CircleMarker
      center={[point.latitude, point.longitude]}
      eventHandlers={layerHandlers(point.staffId, onStaffSelect, register)}
      pathOptions={{
        className: `fleet-map-attendance-marker${selectedClass}`,
        color: selected ? '#facc15' : '#ffffff',
        dashArray: '2 3',
        fillColor: '#2563eb',
        fillOpacity: 0.85,
        opacity: 1,
        weight: selected ? 3 : 2,
      }}
      radius={7}
    >
      <Popup>
        <strong>{point.staffName}</strong>
        <br />
        {point.label}
        <br />
        Recorded at {point.recordedAt}
      </Popup>
    </CircleMarker>
  );
}
function geometryPathOptions(lowConfidence: boolean): PathOptions {
  return {
    className: `fleet-map-operational-geometry${lowConfidence
      ? ' fleet-map-operational-geometry--low-confidence' : ''}`,
    color: lowConfidence ? '#b45309' : '#2563eb',
    dashArray: lowConfidence ? '6 4' : undefined,
    fillColor: lowConfidence ? '#f59e0b' : '#3b82f6',
    fillOpacity: 0.12,
    opacity: 0.9,
    weight: 2,
  };
}
function stableGeometryValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableGeometryValue).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableGeometryValue(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}
function operationalGeometryKey(geometry: OperationalOverlayGeometry): string {
  if (geometry.kind === 'aoi') {
    return `aoi:${geometry.operationalSiteId}:${stableGeometryValue(geometry.geoJson)}`;
  }
  const { latitude, longitude } = geometry.center;
  return `authorized_location:${geometry.operationalSiteId}:${latitude}:${longitude}:${geometry.radiusM}`;
}
function OperationalGeometry({ geometry }: { geometry: OperationalOverlayGeometry }) {
  if (geometry.kind === 'aoi') {
    return (
      <GeoJSON data={geometry.geoJson as unknown as Geometry} pathOptions={geometryPathOptions(geometry.lowConfidence)}>
        <Popup>
          <strong>{geometry.operationalSiteName}</strong>
          {geometry.lowConfidence && <><br />Low confidence geometry</>}
        </Popup>
      </GeoJSON>
    );
  }
  return (
    <Circle
      center={[geometry.center.latitude, geometry.center.longitude]}
      pathOptions={geometryPathOptions(false)}
      radius={geometry.radiusM}
    >
      <Popup><strong>{geometry.operationalSiteName}</strong><br />Authorized Location</Popup>
    </Circle>
  );
}
export function OperationalMapLayers({
  operationalOverlay, vehicles, selectedStaffId, onStaffSelect, focusStaffId, focusRequestId = 0,
}: OperationalMapLayersProps) {
  const map = useMap();
  const plottedByVehicle = new Map(
    partitionVehicles(vehicles).plotted.map((vehicle) => [vehicle.vehicleId, vehicle]),
  );
  const badgeLayers = useRef(new Map<string, FocusLayer>());
  const attendanceLayers = useRef(new Map<string, FocusLayer>());
  const badgeIds = new Set(operationalOverlay.badges
    .filter((badge) => plottedByVehicle.has(badge.vehicleId)).map((badge) => badge.staffId));
  const attendanceIds = new Set(operationalOverlay.attendancePoints.map((point) => point.staffId));
  for (const staffId of badgeLayers.current.keys()) if (!badgeIds.has(staffId)) badgeLayers.current.delete(staffId);
  for (const staffId of attendanceLayers.current.keys()) if (!attendanceIds.has(staffId)) attendanceLayers.current.delete(staffId);
  const register = (registry: Map<string, FocusLayer>): RegisterLayer => (staffId, layer) => {
    if (layer) registry.set(staffId, layer); else registry.delete(staffId);
  };
  const registerBadge = register(badgeLayers.current);
  const registerAttendance = register(attendanceLayers.current);
  useEffect(() => {
    if (!focusStaffId || focusRequestId === 0) return;
    const layer = badgeLayers.current.get(focusStaffId) ?? attendanceLayers.current.get(focusStaffId);
    if (!layer) return;
    map.setView(layer.getLatLng(), Math.max(map.getZoom(), 15));
    layer.openPopup();
  }, [focusRequestId, focusStaffId, map]);
  return (
    <>
      {operationalOverlay.geometry && (
        <OperationalGeometry
          key={operationalGeometryKey(operationalOverlay.geometry)}
          geometry={operationalOverlay.geometry}
        />
      )}
      {operationalOverlay.badges.map((badge) => {
        const vehicle = plottedByVehicle.get(badge.vehicleId);
        return vehicle ? (
          <OperationalBadgeMarker
            key={`operational-badge:${badge.vehicleId}:${badge.staffId}`}
            badge={badge}
            onStaffSelect={onStaffSelect}
            register={registerBadge}
            selected={badge.staffId === selectedStaffId}
            vehicle={vehicle}
          />
        ) : null;
      })}
      {operationalOverlay.attendancePoints.map((point) => (
        <AttendanceMarker
          key={`operational-attendance:${point.staffId}`}
          onStaffSelect={onStaffSelect}
          point={point}
          register={registerAttendance}
          selected={point.staffId === selectedStaffId}
        />
      ))}
    </>
  );
}
