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
 * Redacts recovery phrases in any layout, typos included: the text is split into letter runs (camelCase aware, so
 * underscores, digits and punctuation never hide a word), and any 12-run window holding 8+ BIP39 words is redacted
 * from its first to its last BIP39 word. A lowercase letter run of 20+ letters (a phrase written without
 * separators) is redacted too.
 */
function redactPhraseLike(text: string): string {
  const runs = [...text.matchAll(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    bip: isBip39Word(m[0].toLowerCase()),
    long: m[0].length >= 20 && m[0] === m[0].toLowerCase(),
  }));
  const spans: [number, number][] = runs.filter((r) => r.long).map((r) => [r.start, r.end]);
  for (let i = 0; i + 12 <= runs.length; i++) {
    const words = runs.slice(i, i + 12).filter((r) => r.bip);
    if (words.length >= 8) spans.push([words[0]!.start, words.at(-1)!.end]);
  }
  if (!spans.length) return text;
  spans.sort((a, b) => a[0] - b[0]);
  let out = '';
  let last = 0;
  let cur: [number, number] | null = null;
  for (const span of [...spans, [Infinity, Infinity] as [number, number]]) {
    if (cur && span[0] <= cur[1]) {
      cur[1] = Math.max(cur[1], span[1]);
      continue;
    }
    if (cur) {
      out += text.slice(last, cur[0]) + '<words>';
      last = cur[1];
    }
    cur = [span[0], span[1]];
  }
  return out + text.slice(last);
}

/** Redacts anything that could identify a user or leak a secret from error text before it leaves the device. */
export function scrub(text: string, originHost?: string): string {
  return redactPhraseLike(text)
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
