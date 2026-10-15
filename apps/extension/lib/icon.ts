import type { WalletIcon } from '@wallet-standard/base';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
  '<rect width="128" height="128" rx="28" fill="#111827"/>' +
  '<path d="M84 40a32 32 0 1 0 0 48" fill="none" stroke="#a78bfa" stroke-width="14" stroke-linecap="round"/>' +
  '<circle cx="90" cy="64" r="8" fill="#a78bfa"/>' +
  '</svg>';

export const ICON = `data:image/svg+xml;base64,${btoa(SVG)}` as WalletIcon;
