const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const URLS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>()[\]{}]+/gi;
const TOKENS = /[A-Za-z0-9+/=]{24,}/g;
const DIGITS = /\d{7,}/g;
const PHRASE = /\b(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}\b/g;
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

function hostOf(text: string): string | null {
  try {
    return new URL(text).hostname || null;
  } catch {
    return null;
  }
}

/** Redacts anything that could identify a user or leak a secret from error text before it leaves the device. */
export function scrub(text: string, originHost?: string): string {
  return text
    .replace(URLS, (u) => (originHost && hostOf(u) === originHost ? originHost : '<url>'))
    .replace(TOKENS, (t) => {
      if (t.length >= 32 && B58.test(t)) return '<b58>';
      if (/[+=]/.test(t) || (/[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t))) return '<b64>';
      return t;
    })
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, '<b58>')
    .replace(DIGITS, '<num>')
    .replace(PHRASE, '<words>');
}

/** Opt-in crash reports. Never throws; sends nothing unless an https endpoint is configured and the user enabled it. */
export class ErrorReporter {
  readonly available: boolean;
  private readonly endpoint: string | null;
  private readonly enabled: () => Promise<boolean>;
  private readonly version: string;
  private readonly browser: string;
  private readonly fetch: typeof fetch;

  constructor(o: { endpoint: string | null; enabled: () => Promise<boolean>; version: string; browser: string; fetch?: typeof fetch }) {
    this.endpoint = o.endpoint;
    this.available = o.endpoint !== null && (() => {
      try {
        return new URL(o.endpoint).protocol === 'https:';
      } catch {
        return false;
      }
    })();
    this.enabled = o.enabled;
    this.version = o.version;
    this.browser = o.browser;
    this.fetch = o.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  async report(e: unknown, ctx: { area: string; origin?: string }): Promise<void> {
    try {
      if (!this.available || !this.endpoint || !(await this.enabled())) return;
      const origin = ctx.origin ? (hostOf(ctx.origin) ?? undefined) : undefined;
      const s = (t: string, max: number) => scrub(t, origin).slice(0, max);
      const err = e instanceof Error ? e : null;
      const body = {
        v: 1,
        version: s(this.version, 64),
        browser: s(this.browser, 64),
        area: s(ctx.area, 64),
        ...(origin ? { origin } : {}),
        name: s(err?.name ?? 'Error', 64),
        message: s(err ? err.message : String(e), MAX_MESSAGE),
        stack: s(err?.stack ?? '', MAX_STACK),
      };
      await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
      });
    } catch {
      // Reporting must never surface its own failures.
    }
  }
}
