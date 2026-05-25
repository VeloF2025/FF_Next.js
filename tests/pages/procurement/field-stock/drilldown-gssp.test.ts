/**
 * Unit tests for the getServerSideProps guards on the warehouse / project
 * serial drill-down pages. These do NOT touch the DB (security: no pre-auth
 * entity read) — they only validate the UUID format and pass the id through.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import type { GetServerSidePropsContext } from 'next';

// The page modules import React components we don't need for the SSR logic.
vi.mock('@/components/layout', () => ({ AppLayout: () => null }));
vi.mock('@/components/field-stock/SerialDrilldownView', () => ({ SerialDrilldownView: () => null }));

import { getServerSideProps as warehouseGSSP } from '@/pages/procurement/field-stock/warehouses/[warehouseId]';
import { getServerSideProps as projectGSSP } from '@/pages/procurement/field-stock/projects/[projectId]';

const VALID = 'aaaaaaaa-0000-0000-0000-000000000003';

function ctx(params: Record<string, string | string[] | undefined>): GetServerSidePropsContext {
  return { params } as unknown as GetServerSidePropsContext;
}

describe('warehouse drill-down getServerSideProps', () => {
  it('passes a valid UUID through as props', async () => {
    const result = await warehouseGSSP(ctx({ warehouseId: VALID }));
    expect(result).toEqual({ props: { warehouseId: VALID } });
  });

  it('returns notFound for a non-UUID param (e.g. path traversal)', async () => {
    expect(await warehouseGSSP(ctx({ warehouseId: '../secret' }))).toEqual({ notFound: true });
  });

  it('returns notFound when the param is missing', async () => {
    expect(await warehouseGSSP(ctx({}))).toEqual({ notFound: true });
  });

  it('coerces an array param to its first element', async () => {
    const result = await warehouseGSSP(ctx({ warehouseId: [VALID, 'extra'] }));
    expect(result).toEqual({ props: { warehouseId: VALID } });
  });
});

describe('project drill-down getServerSideProps', () => {
  it('passes a valid UUID through as props', async () => {
    const result = await projectGSSP(ctx({ projectId: VALID }));
    expect(result).toEqual({ props: { projectId: VALID } });
  });

  it('returns notFound for a malformed id', async () => {
    expect(await projectGSSP(ctx({ projectId: 'xyz' }))).toEqual({ notFound: true });
  });

  it('returns notFound when the param is missing', async () => {
    expect(await projectGSSP(ctx({}))).toEqual({ notFound: true });
  });
});
