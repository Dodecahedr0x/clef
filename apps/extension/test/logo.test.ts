import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON, ICON_SVG } from '../lib/icon';
import { LOGO_INK, LOGO_KEY, LOGO_TILE } from '../lib/logo';

describe('Clef mark', () => {
  it('shows sites the same key the app draws, in the theme colours', () => {
    const svg = atob(ICON.slice(ICON.indexOf(',') + 1));
    expect(svg).toContain(`d="${LOGO_KEY.shaft}"`);
    expect(svg).toContain(`r="${LOGO_KEY.circle.r}"`);
    expect(svg).toContain(`stroke="${LOGO_INK}"`);
    expect(svg).toContain(`fill="${LOGO_TILE}"`);
    const theme = readFileSync(join(__dirname, '..', 'assets', 'tailwind.css'), 'utf8');
    expect(theme).toContain(`--color-primary: ${LOGO_INK};`);
    expect(theme).toContain(`--color-primary-bg: ${LOGO_TILE};`);
  });

  it('is the logo the README shows', () => {
    expect(readFileSync(join(__dirname, '..', '..', '..', 'docs', 'logo.svg'), 'utf8')).toBe(`${ICON_SVG}\n`);
  });
});
