/**
 * C0 controls, DEL, C1 controls, the Arabic letter mark, zero-width characters and LRM/RLM, line/paragraph
 * separators, and the bidi embedding/override/isolate characters.
 */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

/**
 * Makes a string from an untrusted source (IDL names, decoded args) safe to display: strips control, invisible
 * and bidi characters (terminal escapes, right-to-left spoofing), then truncates to `max` code points.
 */
export function sanitizeText(s: string, max = 64): string {
  return Array.from(s.replace(UNSAFE, '')).slice(0, max).join('');
}
