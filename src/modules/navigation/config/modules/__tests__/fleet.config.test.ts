import { describe, expect, it } from 'vitest';
import { fleetConfig } from '../fleet.config';
describe('fleet module navigation', () => { it('advertises operational routes with exact RBAC', () => { const entries=fleetConfig.tabs.map((tab)=>[tab.path,tab.rbacKey]); expect(entries).toEqual(expect.arrayContaining([['/fleet/map',undefined],['/fleet/parking','fleet.parking'],['/fleet/parking/requests','fleet.parking-requests'],['/fleet/locations','fleet.locations']])); }); });
