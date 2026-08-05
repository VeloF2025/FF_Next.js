/**
 * A cookie-backed portal session with bounded re-authentication.
 *
 * These are human web portals, not APIs: authentication is a form POST and a
 * session cookie, and the session can die underneath a long run. Netstar in
 * particular enforces a SINGLE session — a second login anywhere fires
 * `POST /Authentication/Account/LogOff` and invalidates the first — so a
 * colleague opening the portal mid-run will log this job out.
 *
 * Re-auth is therefore expected and handled, but capped at one retry per
 * request. Retrying without a cap against a portal that is rejecting us is how
 * an account gets locked.
 */
import { log } from '@/lib/logger';

const DEFAULT_TIMEOUT_MS = 60_000;

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(res: Response): void {
    // Undici exposes multiple Set-Cookie headers via getSetCookie(); fall back
    // to the folded single header on runtimes that lack it.
    const raw =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [res.headers.get('set-cookie') ?? ''];
    for (const line of raw) {
      if (!line) continue;
      const [pair] = line.split(';');
      if (!pair) continue;
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clear(): void {
    this.cookies.clear();
  }
}

export interface PortalSessionOptions {
  baseUrl: string;
  /** Performs the form login, absorbing cookies into the jar. */
  login: (fetchImpl: typeof fetch, jar: CookieJar) => Promise<void>;
  /** True when a response indicates the session is gone (302 to login, etc). */
  isLoggedOut: (res: Response) => boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class PortalSession {
  private readonly jar = new CookieJar();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private authed = false;

  constructor(private readonly opts: PortalSessionOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  reset(): void {
    this.jar.clear();
    this.authed = false;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.authed) {
      await this.opts.login(this.fetchImpl, this.jar);
      this.authed = true;
    }

    let res = await this.send(path, init);
    if (!this.opts.isLoggedOut(res)) return res;

    log.warn('[portal-session] session lost mid-run — re-authenticating once', {
      baseUrl: this.opts.baseUrl,
      path,
    });
    this.reset();
    await this.opts.login(this.fetchImpl, this.jar);
    this.authed = true;

    res = await this.send(path, init);
    if (this.opts.isLoggedOut(res)) {
      // Deliberately not a loop: a portal that rejects us twice is a
      // credentials or entitlement problem, and hammering it risks a lockout.
      throw new Error(`[portal-session] still logged out after re-auth: ${path}`);
    }
    return res;
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = path.startsWith('http')
        ? path
        : `${this.opts.baseUrl.replace(/\/+$/, '')}${path}`;
      const res = await this.fetchImpl(url, {
        ...init,
        redirect: 'manual',
        headers: { ...(init.headers ?? {}), Cookie: this.jar.header() },
        signal: controller.signal,
      });
      this.jar.absorb(res);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}
