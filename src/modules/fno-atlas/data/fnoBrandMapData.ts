export type LatLngTuple = [number, number];

export interface FnoMapPoint {
  label: string;
  position: LatLngTuple;
  note: string;
}

export interface FnoBrandMapProfile {
  fnoId: string;
  brandColor: string;
  brandColorLabel: string;
  brandColorSource: string;
  mapPoints: FnoMapPoint[];
}

export const fnoBrandMapProfiles: FnoBrandMapProfile[] = [
  { fnoId: 'openserve', brandColor: '#0072BC', brandColorLabel: 'Openserve blue', brandColorSource: 'Openserve website/logo palette', mapPoints: [
    { label: 'National reach', position: [-29.1, 24.2], note: 'Incumbent national footprint reference' },
    { label: 'KZN towns', position: [-29.86, 31.02], note: 'Useful default for town feasibility' },
  ] },
  { fnoId: 'vumatel', brandColor: '#EC008C', brandColorLabel: 'Vuma pink', brandColorSource: 'Vumatel pink brand cue', mapPoints: [
    { label: 'Johannesburg / Gauteng', position: [-26.2, 28.04], note: 'Dense suburb and MDU coverage fit' },
    { label: 'Cape Town', position: [-33.92, 18.42], note: 'Premium residential demand fit' },
    { label: 'Durban', position: [-29.86, 31.02], note: 'Metro residential coverage fit' },
  ] },
  { fnoId: 'fibertime', brandColor: '#FFD400', brandColorLabel: 'Fibertime yellow', brandColorSource: 'Fibertime / affordable-access campaign palette approximation', mapPoints: [
    { label: 'Gauteng townships', position: [-26.27, 27.86], note: 'Prepaid underserved-community rollout fit' },
    { label: 'KZN underserved areas', position: [-29.75, 30.88], note: 'Low-LSM / rural-edge candidate' },
  ] },
  { fnoId: 'net99', brandColor: '#FF6A00', brandColorLabel: 'Net Nine Nine orange', brandColorSource: 'Net99 website/prepaid-fibre palette approximation', mapPoints: [
    { label: 'Township FTTH expansion', position: [-26.34, 28.05], note: 'Affordable prepaid/home fibre focus' },
    { label: 'KZN communities', position: [-29.62, 30.39], note: 'Low-income rollout candidate' },
  ] },
  { fnoId: 'dfa', brandColor: '#003A70', brandColorLabel: 'DFA navy', brandColorSource: 'DFA corporate website palette', mapPoints: [
    { label: 'Gauteng metro backhaul', position: [-26.12, 28.08], note: 'Carrier-grade metro route layer' },
    { label: 'Cape Town metro backhaul', position: [-33.9, 18.5], note: 'Metro duct / POP feasibility' },
    { label: 'Durban metro backhaul', position: [-29.82, 31.03], note: 'KZN core route planning' },
  ] },
  { fnoId: 'liquid', brandColor: '#00AEEF', brandColorLabel: 'Liquid cyan', brandColorSource: 'Liquid Intelligent Technologies website palette', mapPoints: [
    { label: 'National enterprise backbone', position: [-28.6, 25.6], note: 'National and cross-border capacity' },
    { label: 'Gauteng enterprise', position: [-26.08, 28.09], note: 'Business fibre / carrier services' },
  ] },
  { fnoId: 'frogfoot', brandColor: '#76B82A', brandColorLabel: 'Frogfoot green', brandColorSource: 'Frogfoot green brand palette', mapPoints: [
    { label: 'Western Cape', position: [-33.72, 19.03], note: 'Cape suburbs and estates' },
    { label: 'Pretoria', position: [-25.75, 28.23], note: 'Pretoria estate/suburb footprint' },
    { label: 'Garden Route', position: [-34.03, 23.05], note: 'Secondary town / Garden Route fit' },
  ] },
  { fnoId: 'metrofibre', brandColor: '#00A3AD', brandColorLabel: 'MetroFibre teal', brandColorSource: 'MetroFibre website/logo palette', mapPoints: [
    { label: 'Gauteng suburbs', position: [-26.03, 28.01], note: 'Suburban FTTH / business fibre' },
    { label: 'KZN regional', position: [-29.55, 30.35], note: 'Regional town expansion candidate' },
  ] },
  { fnoId: 'octotel', brandColor: '#F58220', brandColorLabel: 'Octotel orange', brandColorSource: 'Octotel website/logo palette', mapPoints: [
    { label: 'Cape Town', position: [-33.93, 18.48], note: 'Western Cape focused FTTH/FTTB' },
  ] },
  { fnoId: 'herotel', brandColor: '#E31E24', brandColorLabel: 'Herotel red', brandColorSource: 'Herotel website/logo palette', mapPoints: [
    { label: 'Small towns', position: [-30.56, 22.94], note: 'Secondary town and rural-edge operator' },
    { label: 'Western Cape towns', position: [-33.42, 19.22], note: 'Hybrid fibre/wireless validation needed' },
  ] },
  { fnoId: 'evotel', brandColor: '#6F2DBD', brandColorLabel: 'Evotel purple', brandColorSource: 'Evotel website/logo palette approximation', mapPoints: [
    { label: 'Selected suburbs', position: [-26.17, 27.93], note: 'Suburb-specific FTTH validation' },
  ] },
  { fnoId: 'link-africa', brandColor: '#F5B400', brandColorLabel: 'Link Africa yellow', brandColorSource: 'Link Africa website/logo palette', mapPoints: [
    { label: 'KZN municipal routes', position: [-29.83, 30.99], note: 'Municipal duct/wayleave feasibility' },
    { label: 'Gauteng route assets', position: [-26.14, 28.17], note: 'Metro route overlay' },
  ] },
  { fnoId: 'zoom-fibre', brandColor: '#00A3E0', brandColorLabel: 'Zoom Fibre blue', brandColorSource: 'Zoom Fibre website/logo palette', mapPoints: [
    { label: 'Estates / suburbs', position: [-25.9, 28.12], note: 'Estate and new-development candidate' },
  ] },
  { fnoId: 'lightstruck', brandColor: '#5B2CFF', brandColorLabel: 'Lightstruck violet', brandColorSource: 'Lightstruck website/logo palette approximation', mapPoints: [
    { label: 'Western Cape estates', position: [-34.02, 18.62], note: 'Premium community footprint' },
  ] },
  { fnoId: 'broadband-infraco', brandColor: '#007A3D', brandColorLabel: 'Broadband Infraco green', brandColorSource: 'Broadband Infraco public-sector palette approximation', mapPoints: [
    { label: 'National NLD layer', position: [-29.0, 25.0], note: 'Rural aggregation and public-sector backbone' },
  ] },
  { fnoId: 'seacom', brandColor: '#E31B23', brandColorLabel: 'SEACOM red', brandColorSource: 'SEACOM website/logo palette', mapPoints: [
    { label: 'Coastal / international capacity', position: [-33.85, 18.55], note: 'Subsea, IP transit and carrier path option' },
    { label: 'National enterprise', position: [-26.1, 28.12], note: 'Carrier-grade transit and enterprise services' },
  ] },
];

export function getBrandProfile(fnoId: string): FnoBrandMapProfile | undefined {
  return fnoBrandMapProfiles.find((profile) => profile.fnoId === fnoId);
}
