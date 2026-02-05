/**
 * Suite exports for daily audit
 */

export { runApiHealthSuite } from './api-health';
export { runDatabaseHealthSuite } from './database-health';
export { runExternalServicesSuite } from './external-services';
export { runNavigationSuite } from './navigation';
export { runCrossModuleSuite } from './cross-module';

// Suite registry for dynamic loading
export const suiteRegistry = {
  'api-health': () => import('./api-health').then((m) => m.runApiHealthSuite),
  'database-health': () => import('./database-health').then((m) => m.runDatabaseHealthSuite),
  'external-services': () => import('./external-services').then((m) => m.runExternalServicesSuite),
  'navigation': () => import('./navigation').then((m) => m.runNavigationSuite),
  'cross-module': () => import('./cross-module').then((m) => m.runCrossModuleSuite),
} as const;

export type SuiteName = keyof typeof suiteRegistry;
