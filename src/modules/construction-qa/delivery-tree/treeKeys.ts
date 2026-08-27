/** Stable expansion keys for the delivery tree's project and zone rows. */
export const projectKey = (projectId: string): string => `p:${projectId}`;
export const zoneKey = (projectId: string, zoneNo: number): string => `z:${projectId}:${zoneNo}`;
