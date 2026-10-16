// Captures Chrome Web Store screenshots (1280x800) of the built extension: each scene renders an extension
// page at its native size, then places it centered on a branded 1280x800 canvas with a caption.
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: pnpm tsx scripts/screenshots.ts [options]

Options:
  --ext <dir>          built extension (default apps/extension/.output/chrome-mv3)
  --out <dir>          output directory (default docs/store/screenshots)
  --create-wallet      create a wallet first through the extension's internal API (fresh password + generated phrase)
  --rpc <url>          set the wallet's RPC URL after creating it (e.g. a local surfpool validator)
  --scene <spec>       add a scene; repeatable. spec = name|path|width|height|caption
                       e.g. "portfolio|popup.html|360|600|Know what you sign"
  --help               show this help

Without --scene, captures the default scenes (welcome/portfolio popup and the kitchen sink).
Run "pnpm build:ext" first. Output: <out>/<name>.png, 1280x800.`;

type Scene = { name: string; path: string; width: number; height: number; caption: string };

const DEFAULT_SCENES: Scene[] = [
  { name: '01-popup', path: 'popup.html', width: 360, height: 600, caption: 'A Solana wallet that explains what you sign' },
  { name: '02-components', path: 'kitchen-sink.html', width: 1100, height: 680, caption: 'Clear, verified detail at every level' },
];

function parseScene(spec: string): Scene {
  const [name, path, width, height, caption] = spec.split('|');
  if (!name || !path || !width || !height) throw new Error(`Invalid --scene "${spec}"`);
  return { name, path, width: Number(width), height: Number(height), caption: caption ?? '' };
}

function args(argv: string[]) {
  const get = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const scenes: Scene[] = [];
  argv.forEach((a, i) => {
    if (a === '--scene' && argv[i + 1]) scenes.push(parseScene(argv[i + 1]!));
  });
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    ext: resolve(get('--ext') ?? join('apps', 'extension', '.output', 'chrome-mv3')),
    out: resolve(get('--out') ?? join('docs', 'store', 'screenshots')),
    createWallet: argv.includes('--create-wallet'),
    rpc: get('--rpc'),
    scenes: scenes.length ? scenes : DEFAULT_SCENES,
  };
}

async function internal(page: Page, call: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(async (c) => {
    const rt = (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime;
    const reply = (await rt.sendMessage({ channel: 'internal', call: c })) as { ok: boolean; value?: unknown; error?: string };
    if (!reply?.ok) throw new Error(reply?.error ?? 'no reply');
    return reply.value;
  }, call);
}

async function createWallet(context: BrowserContext, base: string, rpc: string | undefined): Promise<void> {
  const page = await context.newPage();
  await page.goto(`${base}/popup.html`);
  const { mnemonic } = (await internal(page, { type: 'mnemonic:generate' })) as { mnemonic: string };
  await internal(page, { type: 'vault:create', password: 'screenshots-only-password', mnemonic });
  if (rpc) {
    const local = ['localhost', '127.0.0.1'].includes(new URL(rpc).hostname);
    await internal(page, { type: 'settings:update', patch: local ? { network: 'localnet', rpcUrl: rpc } : { network: 'custom', rpcUrl: rpc } });
  }
  await page.close();
}

function framePage(png: Buffer, scene: Scene): string {
  const img = `data:image/png;base64,${png.toString('base64')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1280px;height:800px;background:#F5F6F8;font-family:"IBM Plex Sans",system-ui,sans-serif;color:#14171F}
    .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px}
    h1{margin:0;font-size:34px;font-weight:600;letter-spacing:-0.02em}
    img{border-radius:16px;box-shadow:0 18px 48px rgba(20,23,31,.16),0 0 0 1px #E1E4EA;max-height:640px}
  </style></head><body><div class="wrap">${scene.caption ? `<h1>${scene.caption.replace(/</g, '&lt;')}</h1>` : ''}<img src="${img}" alt=""></div></body></html>`;
}

async function main(argv: string[]): Promise<void> {
  const opts = args(argv);
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  mkdirSync(opts.out, { recursive: true });
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${opts.ext}`, `--load-extension=${opts.ext}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    if (opts.createWallet) await createWallet(context, base, opts.rpc);

    for (const scene of opts.scenes) {
      const page = await context.newPage();
      await page.setViewportSize({ width: scene.width, height: scene.height });
      await page.goto(`${base}/${scene.path}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(800);
      const shot = await page.screenshot({ type: 'png' });
      await page.close();

      const frame = await context.newPage();
      await frame.setViewportSize({ width: 1280, height: 800 });
      await frame.setContent(framePage(shot, scene));
      const file = join(opts.out, `${scene.name}.png`);
      writeFileSync(file, await frame.screenshot({ type: 'png' }));
      await frame.close();
      console.log(`Wrote ${file}`);
    }
  } finally {
    await context.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
