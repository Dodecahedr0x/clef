// Renders the extension's toolbar and store icons (apps/extension/public/icon/{16,48,128}.png) from the same SVG Clef
// gives sites and the README shows (apps/extension/lib/icon.ts), so all of them are one mark. The tile's rounded
// corners stay transparent. Run after changing lib/logo.ts or lib/icon.ts: pnpm icons
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_SVG } from '../apps/extension/lib/icon';

const OUT = resolve(fileURLToPath(import.meta.url), '..', '..', 'apps', 'extension', 'public', 'icon');
// The 128 px file is also the Chrome Web Store icon: 96 px of artwork inside 16 px of transparent padding (see
// docs/store/listing.md). The smaller ones fill their square, as toolbar icons do.
const SIZES = [
  { size: 16, padding: 0 },
  { size: 48, padding: 0 },
  { size: 128, padding: 16 },
];

const browser = await chromium.launch();
try {
  for (const { size, padding } of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const art = size - 2 * padding;
    const svg = ICON_SVG.replace('<svg ', `<svg width="${art}" height="${art}" style="display:block;margin:${padding}px" `);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(join(OUT, `${size}.png`), png);
    await page.close();
    console.log(`icon/${size}.png`);
  }
} finally {
  await browser.close();
}
