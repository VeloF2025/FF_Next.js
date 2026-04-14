/**
 * boqService shim — re-exports boqApiService under the legacy name.
 * Hooks that import from '@/services/procurement/boqService' expect a `boqService` export.
 */
export { boqApiService as boqService, boqApiService } from './boq';
export * from './boq';
