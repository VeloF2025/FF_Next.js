import type { VelocityInstallContext } from './types';

/**
 * Install-context custom fields, addressed by fieldKey rather than field id.
 *
 * The four core fields (DR number, event date, sources, export key) are written by id
 * and each needs its own VELOCITY_GHL_FIELD_*_ID environment variable. GHL also accepts
 * {key, field_value} on the contact upsert — verified against the live Velocity
 * location — so these five need no environment variables and no redeploy to configure.
 *
 * Split out of ghlClient.ts to keep that file under the 300-line cap.
 */
const INSTALL_CONTEXT_KEYS: Record<keyof VelocityInstallContext, string> = {
  installerName: 'velocity_installer',
  installAddress: 'velocity_install_address',
  installGps: 'velocity_install_gps',
  poleNumber: 'velocity_pole_number',
  ontBarcode: 'velocity_ont_barcode',
};

export function installContextFields(context: VelocityInstallContext | undefined):
Array<{ key: string; field_value: string }> {
  if (!context) return [];
  return Object.entries(INSTALL_CONTEXT_KEYS).flatMap(([field, key]) => {
    const value = context[field as keyof VelocityInstallContext];
    // A null is omitted rather than written as '', so a missing pole number never
    // overwrites one that a human filled in on the contact by hand.
    return value ? [{ key, field_value: value }] : [];
  });
}
