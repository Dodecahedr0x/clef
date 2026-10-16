import { isBip39Word } from '@clef/vault';
const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const URLS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>()[\]{}]+/gi;
const TOKENS = /[A-Za-z0-9+/=]{24,}/g;
const DIGITS = /\d{7,}/g;
/**
 * A recovery phrase in any common layout: 12+ word-like tokens (3-8 letters) separated only by short runs of
 * non-letters (spaces, commas, dashes, pipes, quotes, brackets, newlines, list numbers). Over-redacts some plain
 * sentences; that is the safe side.
 */
const PHRASE = /\b[a-z]{3,8}\b(?:[^a-z]{1,8}[a-z]{3,8}\b){11,}/gi;
/** A keypair or seed as a byte list, e.g. a Solana keypair JSON file: 16+ small integers, bracketed or not. */
const BYTE_LIST = /\[\s*\d{1,3}(?:\s*,\s*\d{1,3}){15,}\s*\]|\d{1,3}(?:\s*,\s*\d{1,3}){15,}/g;
const HEX = /\b(?:0x)?[0-9a-f]{16,}\b/gi;
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

function hostOf(text: string): string | null {
  try {
    return new URL(text).hostname || null;
  } catch {
    return null;
  }
}

/**
 * No BIP39 word ever leaves the device: every letter run (camelCase aware, so underscores, digits, labels and
 * punctuation never shield a word) that is a BIP39 word becomes `*`, and a lowercase letter run of 20+ letters (a
 * phrase written without separators) becomes `<words>`. Ordinary words that happen to be BIP39 words ("account")
 * are masked too: readability is traded for a guarantee that no recovery phrase can be reassembled.
 */
function redactPhraseLike(text: string): string {
  return text.replace(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g, (run) => {
    if (run.length >= 20 && run === run.toLowerCase()) return '<words>';
    const word = run.toLowerCase();
    return isBip39Word(word) && !READABLE.has(word) ? '*' : run;
  });
}

/**
 * BIP39 words kept readable because error text needs them (about 2% of the list). A phrase is 12 or 24 random
 * words, so on average it shares well under one word with this set: never enough to rebuild it.
 */
const READABLE = new Set(
  [
    'error', 'type', 'account', 'address', 'custom', 'program', 'wallet', 'token', 'owner', 'invalid', 'unknown',
    'network', 'request', 'result', 'return', 'update', 'version', 'method', 'object', 'number', 'index', 'limit',
    'balance', 'transfer', 'option', 'use', 'denied', 'found', 'missing', 'file', 'line', 'call', 'stack', 'state',
    'key', 'public', 'session', 'window', 'page', 'message', 'reject', 'cancel', 'timeout', 'fail', 'status', 'code',
  ].filter(isBip39Word),
);

/** Redacts anything that could identify a user or leak a secret from error text before it leaves the device. */
export function scrub(text: string, originHost?: string): string {
  const out = text
    .replace(BYTE_LIST, '<bytes>')
    .replace(URLS, (u) => (originHost && hostOf(u) === originHost ? originHost : '<url>'))
    .replace(TOKENS, (t) => {
      if (t.length >= 32 && B58.test(t)) return '<b58>';
      if (/[+=]/.test(t) || (/[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t))) return '<b64>';
      return t;
    })
    .replace(HEX, '<hex>')
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, '<b58>')
    .replace(DIGITS, '<num>')
    .replace(PHRASE, '<words>');
  // Last, so URL and token rules see the original text; the requesting site's hostname is kept as is.
  return originHost ? out.split(originHost).map(redactPhraseLike).join(originHost) : redactPhraseLike(out);
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
