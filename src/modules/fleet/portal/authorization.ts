interface PortalVehicleRequest {
  authType?: 'user' | 'portal';
  portalSession?: {
    vehicleId: string;
  };
}

export function canAccessPortalVehicle(
  req: PortalVehicleRequest,
  vehicleId: string
): boolean {
  return (
    req.authType !== 'portal' ||
    req.portalSession?.vehicleId === vehicleId
  );
}
