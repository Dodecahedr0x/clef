/// <reference types="chrome" />
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
// Unlock runs Argon2id at production cost; under parallel load it can take longer than the default 5 s.
const KDF_TIMEOUT = 20_000;
import { fund, rpcCall } from './surfpool';

const PASSWORD = 'a long password';

const nextApproval = (context: BrowserContext) =>
  context.waitForEvent('page', { predicate: (p) => p.url().includes('/approval.html') });

/** Clicks a button that decides the request; the approval window closes itself right after. */
async function decideAndClose(page: Page, name: string): Promise<void> {
  const closed = page.waitForEvent('close');
  await page.getByRole('button', { name, exact: true }).click({ noWaitAfter: true }).catch(() => {});
  await closed;
}

type Result = { code?: number; message?: string; [k: string]: unknown };
const run = (dapp: Page, action: string) => dapp.evaluate((n) => (window as unknown as { run(n: string): Promise<Result> }).run(n), action);

const internal = <T,>(popup: Page, call: Record<string, unknown>) =>
  popup.evaluate((c) => chrome.runtime.sendMessage({ channel: 'internal', call: c }), call) as Promise<{ ok: boolean; value: T }>;

const LEVEL_MARK = {
  Basic: (p: Page) => p.getByRole('heading', { name: 'Balance changes' }),
  Intermediate: (p: Page) => p.getByRole('heading', { name: /^\d+ instructions?$/ }),
  Expert: (p: Page) => p.getByRole('navigation', { name: 'Transaction sections' }),
} as const;

/** Points the wallet at `rpcUrl` and walks onboarding CREATE up to and including "Finish setup". */
async function createWallet(context: BrowserContext, popup: Page, rpcUrl: string): Promise<void> {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  expect((await internal(popup, { type: 'settings:update', patch: { network: 'localnet', rpcUrl } })).ok).toBe(true);
  await popup.reload();
  await popup.getByRole('button', { name: 'Create a new wallet' }).click();
  await popup.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await popup.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await popup.getByRole('button', { name: 'Continue' }).click();
  const items = popup.locator('ol > li');
  await expect(items).toHaveCount(12);
  const words = await items.evaluateAll((lis) => lis.map((li) => li.lastChild?.textContent?.trim() ?? ''));
  expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true);
  await popup.getByRole('button', { name: 'I wrote them down' }).click();
  for (let i = 0; i < 3; i++) {
    const group = popup.getByRole('group', { name: /^Choose word \d+$/ });
    const label = (await group.getAttribute('aria-label'))!;
    const n = Number(label.replace('Choose word ', ''));
    await group.getByRole('button', { name: words[n - 1]!, exact: true }).click();
    if (i < 2) await expect(popup.getByRole('group', { name: label, exact: true })).toHaveCount(0);
  }
  await popup.getByRole('button', { name: 'Finish setup' }).click();
  await expect.poll(async () => (await internal<{ hasVault: boolean }>(popup, { type: 'state' })).value.hasVault).toBe(true);
}

test('onboarding CREATE lands on home after Finish setup', async ({ context, popup, stubRpc }) => {
  await createWallet(context, popup, stubRpc);
  await expect(popup.getByRole('button', { name: 'Switch account' }).first()).toBeVisible();
});

test('create, lock and unlock, connect, send at every detail level, reject', async ({ context, popup, dapp, base, validator }) => {
  test.setTimeout(240_000);

  // 1. Onboarding: create a new wallet.
  await createWallet(context, popup, validator);
  await expect(popup.getByRole('button', { name: 'Switch account' }).first()).toBeVisible();
  const account = (await internal<{ activeAccount: string | null; unlocked: boolean }>(popup, { type: 'state' })).value.activeAccount;
  expect(account).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  await expect(popup.getByRole('button', { name: 'Switch account' }).first()).toContainText(account!.slice(0, 4));

  // 2. Lock from Settings, then unlock with the password.
  await popup.getByRole('button', { name: 'Settings' }).first().click();
  await popup.getByRole('button', { name: 'Lock now' }).click();
  await expect(popup.getByRole('button', { name: 'Unlock' })).toBeVisible();
  expect((await internal<{ unlocked: boolean }>(popup, { type: 'state' })).value.unlocked).toBe(false);
  await popup.getByLabel('Password', { exact: true }).fill('wrong password');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByText('Wrong password')).toBeVisible({ timeout: KDF_TIMEOUT });
  await popup.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByRole('button', { name: 'Switch account' }).first()).toBeVisible({ timeout: KDF_TIMEOUT });
  expect((await internal<{ unlocked: boolean }>(popup, { type: 'state' })).value.unlocked).toBe(true);

  // 3. Connect from the dApp (real blockhashes from the validator).
  await fund(validator, account!, 1_000_000_000n);
  await dapp.goto(`${base}/?rpc=${encodeURIComponent(validator)}&chain=solana:localnet`);
  const connected = run(dapp, 'connect');
  const connectApproval = await nextApproval(context);
  await expect(connectApproval.getByText('127.0.0.1').first()).toBeVisible();
  await decideAndClose(connectApproval, 'Connect');
  expect(await connected).toEqual({ accounts: [account] });

  // 4. One SOL transfer approved at each detail level, switched in the approval header.
  for (const level of ['Basic', 'Intermediate', 'Expert'] as const) {
    const sent = run(dapp, 'signAndSend');
    const approval = await nextApproval(context);
    const levels = approval.getByRole('radiogroup', { name: 'Detail level' });
    await expect(levels).toBeVisible();
    // Move off the target first so every pass really switches.
    if ((await levels.getByRole('radio', { name: level, exact: true }).getAttribute('aria-checked')) === 'true') {
      await levels.getByRole('radio', { name: level === 'Basic' ? 'Expert' : 'Basic', exact: true }).click();
    }
    await levels.getByRole('radio', { name: level, exact: true }).click();
    await expect(approval.getByRole('radiogroup', { name: 'Detail level' }).getByRole('radio', { name: level, exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(LEVEL_MARK[level](approval).first()).toBeVisible({ timeout: 30_000 });
    for (const other of Object.keys(LEVEL_MARK) as (keyof typeof LEVEL_MARK)[]) {
      if (other !== level) await expect(LEVEL_MARK[other](approval)).toHaveCount(0);
    }
    const ack = approval.getByLabel('I understand I may lose these funds');
    if (await ack.count()) await ack.check();
    const sign = approval.getByRole('button', { name: /^Sign( anyway)?$/ });
    await expect(sign).toBeEnabled();
    const closed = approval.waitForEvent('close');
    await sign.click({ noWaitAfter: true }).catch(() => {});
    await closed;
    const out = await sent;
    expect(out, JSON.stringify(out)).toHaveProperty('signature');
    await expect
      .poll(async () => (await rpcCall<{ value: unknown[] }>(validator, 'getSignatureStatuses', [[out.signature as string], { searchTransactionHistory: true }])).value[0], { timeout: 20_000 })
      .toMatchObject({ err: null });
  }
  expect((await internal<{ settings: { detailLevel: string } }>(popup, { type: 'state' })).value.settings.detailLevel).toBe('expert');

  // 5. Reject: the Reject button and closing the window both return 4001.
  const rejected = run(dapp, 'signAndSend');
  const rejectApproval = await nextApproval(context);
  await expect(rejectApproval.getByRole('radiogroup', { name: 'Detail level' })).toBeVisible();
  await decideAndClose(rejectApproval, 'Reject');
  expect((await rejected).code).toBe(4001);

  const dismissed = run(dapp, 'signAndSend');
  await (await nextApproval(context)).close();
  expect((await dismissed).code).toBe(4001);
});

test('a second recovery phrase is kept and derives its own accounts', async ({ context, popup, stubRpc }) => {
  const ZOO = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
  await createWallet(context, popup, stubRpc);
  await popup.getByRole('button', { name: 'Switch account' }).first().click();
  await popup.getByRole('button', { name: 'Add account' }).click();
  await popup.getByRole('button', { name: /^Import/ }).click();
  await popup.getByLabel('Recovery phrase (12 or 24 words)').fill(ZOO);
  await popup.getByRole('button', { name: 'Import 1 account' }).click();
  await expect.poll(async () => (await internal<{ phrases?: number }>(popup, { type: 'state' })).value.phrases).toBe(2);

  await popup.getByRole('button', { name: 'Switch account' }).first().click();
  await popup.getByRole('button', { name: 'Add account' }).click();
  await popup.getByRole('button', { name: /New account.*Recovery phrase 2/ }).click();
  await expect(popup.getByRole('heading', { name: 'Recovery phrase 2' })).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'Recovery phrase 1' })).toBeVisible();
  const { value } = await internal<{ accounts: { phrase?: number; index?: number }[] }>(popup, { type: 'state' });
  expect(value.accounts.filter((a) => a.phrase === 2).map((a) => a.index)).toEqual([0, 1]);
});
