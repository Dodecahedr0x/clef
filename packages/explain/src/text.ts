/** C0 controls, DEL, C1 controls, and the bidi embedding/override/isolate characters. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/**
 * Makes a string from an untrusted source (IDL names, decoded args) safe to display: strips control and bidi
 * characters (terminal escapes, right-to-left spoofing), then truncates to `max` code points.
 */
export function sanitizeText(s: string, max = 64): string {
  return Array.from(s.replace(UNSAFE, '')).slice(0, max).join('');
}
