import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
const permissions = vi.hoisted(() => [] as Array<[string,string]>);
vi.mock('@/lib/auth/middleware', () => ({ withAuth: (h: unknown) => h, withPermission: (key: string, action: string) => { permissions.push([key,action]); return (h: unknown) => h; } }));
const load = vi.hoisted(() => vi.fn()); vi.mock('@/modules/fleet/parking/runQueries', () => ({ loadParkingRunHealth: load }));
import handler from '@/pages/api/fleet/parking/health';
const call = async (method = 'GET') => { const res = { statusCode: 0, body: undefined as unknown, status(code:number){this.statusCode=code;return this;},json(body:unknown){this.body=body;return this;},setHeader(){return this;},end(){return this;} }; await (handler as unknown as (r:NextApiRequest,s:NextApiResponse)=>Promise<unknown>)({method} as NextApiRequest,res as unknown as NextApiResponse); return res; };
describe('parking health API', () => { beforeEach(() => { vi.clearAllMocks(); load.mockResolvedValue({ state:'healthy' }); }); it('uses fleet.parking:view and returns health', async () => { expect(permissions).toContainEqual(['fleet.parking','view']); expect((await call()).statusCode).toBe(200); }); it('rejects POST', async () => expect((await call('POST')).statusCode).toBe(405)); it('hides database error details', async () => { load.mockRejectedValue(new Error('secret db text')); const res=await call(); expect(res.statusCode).toBe(500); expect(JSON.stringify(res.body)).not.toContain('secret db text'); }); });
