import { describe, it, expect, afterEach } from 'vitest';
import { isVlmProxyAuthorized, vlmProxyKeyParam } from '../photoProxyAuth';

const ORIG = process.env.VLM_PROXY_SECRET;
afterEach(() => {
  if (ORIG === undefined) delete process.env.VLM_PROXY_SECRET;
  else process.env.VLM_PROXY_SECRET = ORIG;
});

describe('isVlmProxyAuthorized', () => {
  it('denies when no secret is configured (fail closed)', () => {
    delete process.env.VLM_PROXY_SECRET;
    expect(isVlmProxyAuthorized({ vlm: 'true', vlmkey: 'anything' })).toBe(false);
  });
  it('authorizes vlm=true with a matching vlmkey', () => {
    process.env.VLM_PROXY_SECRET = 's3cr3t-value';
    expect(isVlmProxyAuthorized({ vlm: 'true', vlmkey: 's3cr3t-value' })).toBe(true);
  });
  it('denies a wrong vlmkey', () => {
    process.env.VLM_PROXY_SECRET = 's3cr3t-value';
    expect(isVlmProxyAuthorized({ vlm: 'true', vlmkey: 'nope' })).toBe(false);
  });
  it('denies a vlmkey of a different length (timingSafeEqual guard)', () => {
    process.env.VLM_PROXY_SECRET = 's3cr3t-value';
    expect(isVlmProxyAuthorized({ vlm: 'true', vlmkey: 'x' })).toBe(false);
  });
  it('denies when vlm is not exactly "true"', () => {
    process.env.VLM_PROXY_SECRET = 's3cr3t-value';
    expect(isVlmProxyAuthorized({ vlm: 'false', vlmkey: 's3cr3t-value' })).toBe(false);
    expect(isVlmProxyAuthorized({ vlmkey: 's3cr3t-value' })).toBe(false);
  });
  it('denies when vlmkey is missing or an array', () => {
    process.env.VLM_PROXY_SECRET = 's3cr3t-value';
    expect(isVlmProxyAuthorized({ vlm: 'true' })).toBe(false);
    expect(isVlmProxyAuthorized({ vlm: 'true', vlmkey: ['s3cr3t-value'] })).toBe(false);
  });
});

describe('vlmProxyKeyParam', () => {
  it('includes an URL-encoded secret when configured', () => {
    process.env.VLM_PROXY_SECRET = 'a b+c';
    expect(vlmProxyKeyParam()).toBe(`&vlm=true&vlmkey=${encodeURIComponent('a b+c')}`);
  });
  it('emits vlm=true only when no secret (proxy then fails closed)', () => {
    delete process.env.VLM_PROXY_SECRET;
    expect(vlmProxyKeyParam()).toBe('&vlm=true');
  });
});
