/// <reference types="chrome" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a long password';
const DAPP = readFileSync(join(import.meta.dirname, 'dapp', 'index.html'), 'utf8');
// https so the content scripts match; never resolved, every request is fulfilled by the route below.
const PHISH = 'https://clef-phish.test';

type Reply<T = unknown> = { ok: boolean; value?: T; error?: unknown };
type Settings = { network: string; rpcUrl: string; detailLevel: string; networkSwitchInHeader: boolean };

declare global {
  interface Window {
    run(name: string): Promise<any>;
  }
}

const internal = <T,>(page: Page, call: unknown) =>
  page.evaluate((c) => chrome.runtime.sendMessage({ channel: 'internal', call: c }), call) as Promise<Reply<T>>;

const settingsOf = async (page: Page) => {
  const r = await internal<{ settings: Settings }>(page, { type: 'state' });
  expect(r.ok).toBe(true);
  return r.value!.settings;
};

/** Nothing may leave the machine: every request not aimed at 127.0.0.1 is aborted. */
const offline = (context: BrowserContext) => context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort());

async function importWallet(popup: Page, rpcUrl: string) {
  const r = await internal(popup, { type: 'settings:update', patch: { network: 'localnet', rpcUrl } });
  expect(r.ok).toBe(true);
  await popup.reload();
  await popup.getByRole('button', { name: 'I already have a wallet' }).click();
  await popup.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await popup.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await popup.getByRole('button', { name: 'Continue' }).click();
  await popup.getByLabel('Recovery phrase (12 or 24 words)').fill(ABANDON);
  await popup.getByRole('button', { name: 'Import 1 account' }).click();
  await expect(popup.getByText('HAgk…Kpqk').first()).toBeVisible();
}

test('the header network picker moves between networks and saved custom RPCs', async ({ context, popup, stubRpc }) => {
  await offline(context);
  await importWallet(popup, stubRpc);
  // Mainnet requires an https RPC: its public default, aborted by the offline route.
  let r = await internal(popup, { type: 'settings:update', patch: { network: 'custom', rpcUrl: 'https://rpc.clef-custom.test/?api-key=secret', customCluster: 'devnet' } });
  expect(r.ok).toBe(true);
  r = await internal(popup, { type: 'settings:update', patch: { network: 'mainnet', detailLevel: 'expert', networkSwitchInHeader: true } });
  expect(r.ok).toBe(true);
  await popup.reload();

  const chip = popup.getByRole('button', { name: /^Network: / });
  const list = popup.getByRole('listbox', { name: 'Network' });
  const pick = async (name: RegExp) => {
    await chip.click();
    await list.getByRole('option', { name }).click();
    await expect(list).toHaveCount(0);
  };
  await expect(chip).toHaveAccessibleName('Network: Mainnet');
  await chip.click();
  await expect(list.getByRole('option')).toHaveCount(4);
  await expect(list.getByRole('option', { name: /rpc\.clef-custom\.test/ })).toContainText('Devnet');
  await expect(list).not.toContainText('secret');
  await popup.screenshot({ path: process.env.SHOT_OUT ? `${process.env.SHOT_OUT}/picker-expert.png` : test.info().outputPath('picker.png') });
  await popup.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(chip).toBeFocused();

  await pick(/^Devnet/);
  await expect(chip).toHaveAccessibleName('Network: Devnet');
  expect((await settingsOf(popup)).network).toBe('devnet');

  await pick(/rpc\.clef-custom\.test/);
  await expect(chip).toHaveAccessibleName('Network: Devnet · custom RPC');
  expect(await settingsOf(popup)).toMatchObject({ network: 'custom', rpcUrl: 'https://rpc.clef-custom.test/?api-key=secret' });

  // Keyboard: open with Down, move with the arrows, pick with Enter.
  await chip.focus();
  await popup.keyboard.press('ArrowDown');
  await expect(list).toBeFocused();
  await popup.keyboard.press('Home');
  await popup.keyboard.press('Enter');
  await expect(chip).toHaveAccessibleName('Network: Mainnet');
  expect((await settingsOf(popup)).network).toBe('mainnet');
});

test('a phishing-listed origin needs an acknowledgement before it can connect', async ({ context, popup, extensionId, stubRpc }) => {
  await offline(context);
  await context.route(`${PHISH}/**`, (r) => r.fulfill({ contentType: 'text/html', body: DAPP }));

  // A stored list newer than the bundled snapshot wins once a fresh service worker loads it.
  await popup.evaluate(() =>
    chrome.storage.local.set({
      phishingList: { version: 2, tolerance: 0, fuzzylist: [], whitelist: [], blacklist: ['clef-phish.test'], fetchedAt: Date.now() },
    }),
  );
  const cdp = await context.newCDPSession(popup);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const fresh = await context.newPage();
  await fresh.goto(`chrome-extension://${extensionId}/popup.html`);
  await importWallet(fresh, stubRpc);

  const site = await context.newPage();
  await site.goto(`${PHISH}/`);
  const approvalOpened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/approval.html') });
  const result = site.evaluate(() => window.run('connect'));
  const approval = await approvalOpened;

  await expect(approval.getByRole('alert').filter({ hasText: 'This site is on a phishing list' })).toBeVisible();
  await expect(approval.getByText('· listed as clef-phish.test')).toBeVisible();
  const connect = approval.getByRole('button', { name: 'Connect anyway' });
  await expect(connect).toBeDisabled();

  await approval.getByLabel('I understand this site is on a phishing list').check();
  await expect(connect).toBeEnabled();
  const closed = approval.waitForEvent('close');
  await connect.click({ noWaitAfter: true }).catch(() => {});
  await closed;

  expect(await result).toEqual({ accounts: ['HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'] });
});
