/// <reference types="chrome" />
// Chrome Web Store screenshots of real requests on a local validator. Not part of `pnpm e2e`:
// run with `pnpm screenshots:store` (needs `pnpm build:ext`). Writes docs/store/screenshots/01-05.png.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { address } from '@solana/kit';
import type { BrowserContext, Page } from '@playwright/test';
import { frame } from '../scripts/screenshots';
import { expect, test } from './fixtures';
import { fund } from './surfpool';

test.skip(!process.env.CLEF_SCREENSHOTS, 'store screenshots run only through pnpm screenshots:store');

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a long password';
const A = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
const DAPP = readFileSync(join(import.meta.dirname, 'dapp', 'index.html'), 'utf8');
const OUT = join(import.meta.dirname, '..', 'docs', 'store', 'screenshots');
// https so the content scripts match; never resolved, every request is fulfilled by routes.
const SITE = 'https://app.example';
const PHISH = 'https://clef-phish.test';
const POPUP = { width: 360, height: 600 };
const APPROVAL = { width: 400, height: 680 };
const EXPERT = { width: 760, height: 960 };

declare global {
  interface Window {
    run(name: string): Promise<unknown>;
  }
}

const internal = (page: Page, call: unknown) => page.evaluate((c) => chrome.runtime.sendMessage({ channel: 'internal', call: c }), call);
const nextApproval = (context: BrowserContext) => context.waitForEvent('page', { predicate: (p) => p.url().includes('/approval.html') });

async function capture(context: BrowserContext, page: Page, size: { width: number; height: number }, name: string, caption: string) {
  await page.setViewportSize(size);
  await page.waitForTimeout(600);
  const png = await page.screenshot({ type: 'png' });
  writeFileSync(join(OUT, `${name}.png`), await frame(context, png, { ...size, caption }));
}

test('store screenshots', async ({ context, popup, extensionId, validator }) => {
  test.setTimeout(180_000);
  // Offline apart from the validator; Jupiter prices and the dApp origins are served locally.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort());
  await context.route(/\/price\/v3/, (r) => {
    const ids = new URL(r.request().url()).searchParams.get('ids')?.split(',') ?? [];
    r.fulfill({ json: Object.fromEntries(ids.map((id) => [id, { usdPrice: 182.4, priceChange24h: 2.1 }])) });
  });
  for (const origin of [SITE, PHISH]) await context.route(`${origin}/**`, (r) => r.fulfill({ contentType: 'text/html', body: DAPP }));
  // The https dApp cannot call the http validator (mixed content), so its RPC is proxied through its own origin.
  await context.route(`${SITE}/rpc`, async (r) => r.fulfill({ response: await r.fetch({ url: validator }) }));

  await popup.evaluate(() =>
    chrome.storage.local.set({
      phishingList: { version: 2, tolerance: 0, fuzzylist: [], whitelist: [], blacklist: ['clef-phish.test'], fetchedAt: Date.now() },
    }),
  );
  const cdp = await context.newCDPSession(popup);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const wallet = await context.newPage();
  await wallet.goto(`chrome-extension://${extensionId}/popup.html`);

  await fund(validator, A, 12.5 * 1_000_000_000);
  await internal(wallet, { type: 'settings:update', patch: { network: 'localnet', rpcUrl: validator, detailLevel: 'basic' } });
  await wallet.reload();
  await wallet.getByRole('button', { name: 'I already have a wallet' }).click();
  await wallet.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await wallet.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await wallet.getByRole('button', { name: 'Continue' }).click();
  await wallet.getByLabel('Recovery phrase (12 or 24 words)').fill(ABANDON);
  await wallet.getByRole('button', { name: 'Import 1 account' }).click();
  await expect(wallet.getByText('HAgk…Kpqk').first()).toBeVisible();

  const dapp = await context.newPage();
  await dapp.goto(`${SITE}/?rpc=${encodeURIComponent(`${SITE}/rpc`)}&chain=solana:localnet`);
  const connected = dapp.evaluate(() => window.run('connect'));
  let approval = await nextApproval(context);
  const closed = approval.waitForEvent('close');
  await approval.getByRole('button', { name: 'Connect', exact: true }).click({ noWaitAfter: true }).catch(() => {});
  await closed;
  await connected;

  // 1. Basic: one transfer, explained.
  void dapp.evaluate(() => window.run('signAndSend'));
  approval = await nextApproval(context);
  await expect(approval.getByText('SOL').first()).toBeVisible();
  await capture(context, approval, APPROVAL, '01-approval-basic', 'Know what you sign, in plain words');
  await approval.close();

  // 2. Expert: three transfers, combined state changes.
  await internal(wallet, { type: 'settings:update', patch: { detailLevel: 'expert' } });
  void dapp.evaluate(() => window.run('signBatch'));
  approval = await nextApproval(context);
  await expect(approval.getByRole('tablist', { name: 'Transactions in this request' })).toBeVisible();
  await capture(context, approval, EXPERT, '02-approval-expert', 'Every state change, log and relation in Expert');
  await approval.close();

  // 3. A phishing-listed site.
  await internal(wallet, { type: 'settings:update', patch: { detailLevel: 'basic' } });
  const phish = await context.newPage();
  await phish.goto(`${PHISH}/`);
  void phish.evaluate(() => window.run('connect'));
  approval = await nextApproval(context);
  await expect(approval.getByRole('alert').filter({ hasText: 'This site is on a phishing list' })).toBeVisible();
  await capture(context, approval, APPROVAL, '03-phishing', 'Dangerous requests are stopped before you sign');
  await approval.close();

  // 4. Portfolio.
  await wallet.reload();
  await expect(wallet.getByText('12.5 SOL')).toBeVisible();
  await capture(context, wallet, POPUP, '04-portfolio', 'Your tokens, prices and history');

  // 5. Hardware wallets.
  const hw = await context.newPage();
  await hw.goto(`chrome-extension://${extensionId}/hardware.html?kind=ledger`);
  await expect(hw.getByRole('button', { name: 'Connect Ledger' })).toBeVisible();
  await capture(context, hw, { width: 400, height: 640 }, '05-ledger', 'Ledger and Keystone hardware wallets');
});
