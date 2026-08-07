/**
 * Ituran barrel.
 *
 * `./session` is deliberately NOT re-exported: it imports Playwright, a
 * devDependency, and a barrel that pulled it in would drag the browser into
 * anything importing this folder. Import it directly from the one script that
 * mints.
 */
export { ituranClient, IturanError, type IturanClient, type IturanSession } from './client';
export { ituranProvider, type IturanProviderOptions } from './provider';
export {
  isLoginError,
  newestFixAt,
  parseUtcTimestamp,
  readIgnition,
  toPositions,
  toVehicles,
  type IturanGridResponse,
  type IturanGridRow,
} from './parse';
