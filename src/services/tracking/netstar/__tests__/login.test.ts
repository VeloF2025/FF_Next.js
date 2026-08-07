import { describe, it, expect } from 'vitest';
import { extractVerificationToken, netstarClient } from '../client';

const LOGIN_PAGE = '<html><form action="/VigilCloud4/Authentication/" method="post">'
  + '<input name="__RequestVerificationToken" type="hidden" value="TOKEN-abc123" />'
  + '<input name="UserName" /><input name="Password" type="password" /></form></html>';

/** Answers the two-step login, then the tree, so listVehicles can drive it. */
function treeFetch(body: unknown, status = 200, loginPage: string = LOGIN_PAGE) {
  const logins: Array<{ url: string; body: string }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.endsWith('/Authentication/Account/Login')) {
      return new Response(loginPage, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    if (url.endsWith('/Authentication/')) {
      logins.push({ url, body: String(init?.body ?? '') });
      return new Response(null, { status: 302, headers: { location: '/VigilCloud4/Main' } });
    }
    if (url.includes('/Main/VehicleRepo/GetVehicleTreeDataPaging')) {
      return new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`treeFetch: unexpected url ${url}`);
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, logins };
}

const LEAF = (leafId: number, name: string) => ({
  LeafId: leafId, Name: name, GroupName: 'Ungrouped',
  Lat: -26.1, Long: 28.3, DateTimeUtc: '/Date(1786039740000)/',
});

/**
 * The login is anti-forgery protected and the form does NOT post back to the
 * URL that serves it. Getting either wrong establishes no session, and the
 * failure surfaces much later as "still logged out after re-auth" against
 * whatever endpoint happened to run next — which is exactly how this shipped.
 */
describe('netstarClient login', () => {
  function build(loginPage?: string) {
    const t = treeFetch({ data: [LEAF(1, 'A')] }, 200, loginPage);
    return { ...t, client: netstarClient({
      baseUrl: 'https://x.test/VigilCloud4', username: 'u', password: 'p',
      fetchImpl: t.fetchImpl, sleep: async () => {},
    }) };
  }

  it('POSTs to /Authentication/, not to the page that served the form', async () => {
    const { client, logins } = build();
    await client.listVehicles();
    expect(logins).toHaveLength(1);
    expect(logins[0]!.url).toBe('https://x.test/VigilCloud4/Authentication/');
  });

  it('carries the __RequestVerificationToken lifted from the page', async () => {
    const { client, logins } = build();
    await client.listVehicles();
    const sent = new URLSearchParams(logins[0]!.body);
    expect(sent.get('__RequestVerificationToken')).toBe('TOKEN-abc123');
    expect(sent.get('UserName')).toBe('u');
    expect(sent.get('Password')).toBe('p');
  });

  it('submits the timezone fields the form carries', async () => {
    const { client, logins } = build();
    await client.listVehicles();
    const sent = new URLSearchParams(logins[0]!.body);
    expect(sent.get('timeZone')).toBe('120');
    expect(sent.get('timeZoneName')).toBe('South Africa Standard Time');
  });

  // Naming the cause here beats a logged-out error three calls later.
  it('fails loudly when the page carries no token', async () => {
    const { client } = build('<html><form action="/x"><input name="UserName" /></form></html>');
    await expect(client.listVehicles()).rejects.toThrow(/no __RequestVerificationToken/);
  });
});

/**
 * Markup this codebase does not control, on an authentication path where a
 * rejected login risks an account lockout. Every case below is drawn from what
 * the live page actually looks like, or from a plausible reshuffle of it.
 */
describe('extractVerificationToken', () => {
  const input = (attrs: string) => `<html><form><input ${attrs} /></form></html>`;

  it('reads the token from the shape the live page serves', () => {
    // Verbatim attribute order from profleet.netstar.co.za, 2026-08-07.
    expect(extractVerificationToken(
      input('name="__RequestVerificationToken" type="hidden" value="TOK-1"')
    )).toBe('TOK-1');
  });

  it('tolerates value appearing before name', () => {
    expect(extractVerificationToken(
      input('value="TOK-2" type="hidden" name="__RequestVerificationToken"')
    )).toBe('TOK-2');
  });

  it('tolerates single quotes', () => {
    expect(extractVerificationToken(
      input("name='__RequestVerificationToken' value='TOK-3'")
    )).toBe('TOK-3');
  });

  it('tolerates loose whitespace around the equals signs', () => {
    expect(extractVerificationToken(
      input('name = "__RequestVerificationToken"  value = "TOK-4"')
    )).toBe('TOK-4');
  });

  // The live page has TWO forms — login and forgot-password — both posting to
  // /Authentication/. Taking the first token matches how the portal's own JS
  // selects it: $('input[name=__RequestVerificationToken]').val(), global
  // rather than form-scoped.
  it('takes the first token when the page carries more than one', () => {
    const html = '<form id="frmFormLogin">'
      + '<input name="__RequestVerificationToken" type="hidden" value="LOGIN-TOK" />'
      + '</form><form id="frmForgotPass">'
      + '<input name="__RequestVerificationToken" type="hidden" value="FORGOT-TOK" />'
      + '</form>';
    expect(extractVerificationToken(html)).toBe('LOGIN-TOK');
  });

  it('is not fooled by a different input that merely mentions the name', () => {
    const html = '<input name="decoy" value="__RequestVerificationToken" />'
      + '<input name="__RequestVerificationToken" value="REAL" />';
    expect(extractVerificationToken(html)).toBe('REAL');
  });

  it('returns null when the token input has no value', () => {
    expect(extractVerificationToken(input('name="__RequestVerificationToken" value=""'))).toBeNull();
  });

  it('returns null on a page with no token at all', () => {
    expect(extractVerificationToken('<html><form><input name="UserName" /></form></html>')).toBeNull();
  });
});
