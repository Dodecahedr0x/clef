/**
 * Clef's mark, a key, on a 24×24 grid: the one drawing behind the in-app Logo, the icon sites show in their wallet
 * list (lib/icon.ts) and the toolbar icons. No React here: the site icon is built in the page script.
 */
export const LOGO_KEY = { circle: { cx: 9, cy: 12, r: 3.2 }, shaft: 'M12.2 12H20M17 12v3M20 12v2', strokeWidth: 1.8 } as const;

/** The brand colours, as in assets/tailwind.css (--color-primary, --color-primary-bg). */
export const LOGO_INK = '#4A6B12';
export const LOGO_TILE = '#EEF5DD';
