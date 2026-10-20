import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Sizes and radii come from the scales in assets/tailwind.css, so one value has one spelling.
const ROOTS = ['entrypoints', 'components', 'lib'].map((d) => join(__dirname, '..', d));
const ARBITRARY = /(?<![\w-])(?:text-\[\d+(?:\.\d+)?(?:px|rem|em)\]|rounded(?:-[a-z]{1,2})?-\[[^\]]+\])/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('design tokens', () => {
  it('uses the type and radius scales, never an arbitrary size or radius', () => {
    const found = ROOTS.flatMap(files).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(ARBITRARY)].map((m) => `${f.slice(f.indexOf('extension/') + 10)}: ${m[0]}`));
    expect(found).toEqual([]);
  });
});
