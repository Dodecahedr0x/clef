/**
 * Control (Cc: C0, DEL, C1), format (Cf: soft hyphen, zero-width, LRM/RLM, ALM, bidi embeddings/overrides/
 * isolates, BOM, word joiner, tag characters, U+180E), surrogate (Cs: lone halves), line/paragraph separators
 * (Zl, Zp), the Hangul fillers (blank-looking letters) and variation selectors. Duplicated in
 * packages/idl/src/resolver.ts (which cannot import this package): keep the two in sync.
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u115f\u1160\u3164\uffa0\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu;

/**
 * Makes a string from an untrusted source (IDL names, decoded args) safe to display: strips control, invisible
 * and bidi characters (terminal escapes, right-to-left spoofing), then truncates to `max` code points.
 */
export function sanitizeText(s: string, max = 64): string {
  return Array.from(s.replace(UNSAFE, '')).slice(0, max).join('');
}

/**
 * For text the user signs: nothing is dropped or cut. Each unsafe character (except tab) is shown as a visible
 * marker such as `⟨U+202E⟩`, so a right-to-left override or a zero-width space cannot hide what is signed.
 */
export function markUnsafe(s: string): { text: string; marked: number } {
  let marked = 0;
  const text = s.replace(UNSAFE, (c) => {
    if (c === '\t') return c;
    marked++;
    return `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`;
  });
  return { text, marked };
}
