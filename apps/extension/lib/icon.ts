import type { WalletIcon } from '@wallet-standard/base';
import { LOGO_INK, LOGO_KEY, LOGO_TILE } from './logo';

const { circle, shaft, strokeWidth } = LOGO_KEY;

// The in-app key on a light tile, so it reads on a site's light or dark wallet list. The view box is the key's own
// extent (x 4.9 to 20.9 with its round caps, centred on y 12), so it fills about 70% of the tile's width.
// docs/logo.svg, shown in the README, is this same file (test/logo.test.ts).
export const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
  `<rect width="128" height="128" rx="28" fill="${LOGO_TILE}"/>` +
  `<svg x="18" y="18" width="92" height="92" viewBox="4.9 3.95 16 16" fill="none" stroke="${LOGO_INK}" stroke-width="${strokeWidth}" stroke-linecap="round">` +
  `<circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}"/><path d="${shaft}"/>` +
  '</svg></svg>';

export const ICON = `data:image/svg+xml;base64,${btoa(ICON_SVG)}` as WalletIcon;
