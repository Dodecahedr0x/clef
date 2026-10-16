import {
  address,
  getBase64Encoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  verifySignature,
} from '@solana/kit';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fund, rpcCall } from './surfpool';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a long password';
const A = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
const SOL = 1_000_000_000;

type Result = Record<string, unknown> & { code?: number };

declare global {
  interface Window {
    run(name: string): Promise<Result>;
  }
}

const nextApproval = (context: BrowserContext) =>
  context.waitForEvent('page', { predicate: (p) => p.url().includes('/approval.html') });

/** Clicks a button that decides the request; the approval window closes itself right after. */
async function decideAndClose(page: Page, name: string | RegExp): Promise<void> {
  const closed = page.waitForEvent('close');
  await page.getByRole('button', { name, exact: typeof name === 'string' }).click({ noWaitAfter: true }).catch(() => {});
  await closed;
}

const run = (dapp: Page, name: string) => dapp.evaluate((n) => window.run(n), name);

/** Imports the deterministic wallet against the validator, then connects the dApp (served with ?rpc=&chain=localnet). */
async function setup(
  { context, popup, dapp, base, validator }: { context: BrowserContext; popup: Page; dapp: Page; base: string; validator: string },
  detailLevel: 'basic' | 'intermediate' | 'expert' = 'intermediate',
): Promise<void> {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await fund(validator, A, 10 * SOL);
  const reply = await popup.evaluate(
    ({ rpc, level }) =>
      chrome.runtime.sendMessage({ channel: 'internal', call: { type: 'settings:update', patch: { network: 'localnet', rpcUrl: rpc, detailLevel: level } } }),
    { rpc: validator, level: detailLevel },
  );
  expect(reply).toMatchObject({ ok: true });
  await popup.reload();

  await popup.getByRole('button', { name: 'I already have a wallet' }).click();
  await popup.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await popup.getByLabel('Confirm password').fill(PASSWORD);
  await popup.getByRole('button', { name: 'Continue' }).click();
  await popup.getByLabel('Recovery phrase (12 or 24 words)').fill(ABANDON);
  await popup.getByRole('button', { name: 'Import 1 account' }).click();
  await expect(popup.getByText('HAgk…Kpqk').first()).toBeVisible();

  await dapp.goto(`${base}/?rpc=${encodeURIComponent(validator)}&chain=solana:localnet`);
  const connected = run(dapp, 'connect');
  const approval = await nextApproval(context);
  await decideAndClose(approval, 'Connect');
  expect(await connected).toEqual({ accounts: [A] });
}

async function verifySigned(b64: string): Promise<void> {
  const tx = getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(b64)));
  const signature = tx.signatures[A];
  expect(signature).toBeTruthy();
  expect(await verifySignature(await getPublicKeyFromAddress(A), signature!, tx.messageBytes)).toBe(true);
}

test('batch of 3: sequential combined view, per-tx tabs at Intermediate/Expert, combined only at Basic', async ({ context, popup, dapp, base, validator }) => {
  await setup({ context, popup, dapp, base, validator }, 'intermediate');

  const signed = run(dapp, 'signBatch');
  const approval = await nextApproval(context);
  const tabs = approval.getByRole('tablist', { name: 'Transactions in this request' });
  const level = approval.getByRole('radiogroup', { name: 'Detail level' });

  // Intermediate: combined view simulated in order, plus one tab per tx.
  await expect(approval.getByText('All 3 together')).toBeVisible({ timeout: 30_000 });
  await expect(approval.getByText('Simulated in order')).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await tabs.getByRole('tab', { name: /^2 · / }).click();
  await expect(tabs.getByRole('tab', { name: /^2 · / })).toHaveAttribute('aria-selected', 'true');
  await expect(approval.getByText('All 3 together')).toHaveCount(0);
  await tabs.getByRole('tab', { name: 'All 3 · combined' }).click();
  await expect(approval.getByText('All 3 together')).toBeVisible();

  // Expert: same tabs, combined meta says the batch was simulated in sequence.
  await level.getByRole('radio', { name: 'Expert' }).click();
  await expect(approval.getByText(/3 transactions in sequence/)).toBeVisible({ timeout: 30_000 });
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await tabs.getByRole('tab', { name: /^2 · / }).click();
  await expect(approval.getByRole('heading', { name: 'Transaction 2 details' })).toBeVisible();
  await tabs.getByRole('tab', { name: 'All 3 · combined' }).click();
  await expect(approval.getByRole('heading', { name: 'Request details' })).toBeVisible();

  // Basic: combined view only, no per-tx tabs.
  await level.getByRole('radio', { name: 'Basic' }).click();
  await expect(approval.getByText('3 transactions, signed together')).toBeVisible({ timeout: 30_000 });
  await expect(tabs).toHaveCount(0);

  const ack = approval.getByLabel('I understand I may lose these funds');
  if (await ack.count()) await ack.check();
  await decideAndClose(approval, /^Sign all 3/);
  const out = (await signed) as { signedTransactions?: string[] };
  expect(out.signedTransactions).toHaveLength(3);
  for (const b64 of out.signedTransactions!) await verifySigned(b64);
});

test('signMessage shows the text and verifies; a tx look-alike is blocked', async ({ context, popup, dapp, base, validator }) => {
  await setup({ context, popup, dapp, base, validator });

  const signed = run(dapp, 'signMessage');
  const approval = await nextApproval(context);
  await expect(approval.getByText('Hello from the Clef test dApp')).toBeVisible();
  await expect(approval.getByText('Readable text — not a hidden transaction')).toBeVisible();
  await decideAndClose(approval, 'Sign');
  expect(await signed).toEqual({ verified: true });

  // Look-alike: danger shown, Sign stays disabled (no acknowledgement can unlock it), rejecting returns 4001.
  const lookAlike = run(dapp, 'signMessageTxLookAlike');
  const danger = await nextApproval(context);
  await expect(danger.getByText('This message is a Solana transaction')).toBeVisible();
  await expect(danger.getByRole('button', { name: 'Sign', exact: true })).toBeDisabled();
  await expect(danger.getByRole('checkbox')).toHaveCount(0);
  await decideAndClose(danger, 'Reject');
  expect(await lookAlike).toMatchObject({ code: 4001 });
});

test('signIn (SIWS) shows the domain matching the origin and verifies', async ({ context, popup, dapp, base, validator }) => {
  await setup({ context, popup, dapp, base, validator });
  const host = new URL(base).host;

  const signed = run(dapp, 'signIn');
  const approval = await nextApproval(context);
  await expect(approval.getByRole('heading', { name: `Sign in to ${host}` })).toBeVisible();
  await expect(approval.getByRole('definition').filter({ hasText: host }).first()).toHaveText(host);
  await expect(approval.getByText('✓ matches tab')).toBeVisible();
  await decideAndClose(approval, 'Sign in');
  const out = (await signed) as { address?: string; verified?: boolean; signedMessage?: string };
  expect(out.address).toBe(A);
  expect(out.verified).toBe(true);
  expect(out.signedMessage).toContain(`${host} wants you to sign in`);
});

test('Send SOL from the popup: approval window, then a confirmed signature on the validator', async ({ context, popup, dapp, base, validator }) => {
  await setup({ context, popup, dapp, base, validator });
  const to = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const before = (await rpcCall<{ value: number }>(validator, 'getBalance', [to])).value;

  await popup.getByRole('navigation', { name: 'Wallet actions' }).getByRole('button', { name: 'Send' }).click();
  await expect(popup.getByText(/Balance 10/)).toBeVisible({ timeout: 30_000 });
  await popup.getByRole('textbox', { name: 'Amount' }).fill('0.5');
  await popup.getByRole('textbox', { name: 'To' }).fill(to);
  const review = popup.getByRole('button', { name: 'Review' });
  await expect(review).toBeEnabled({ timeout: 30_000 });
  const approvalP = nextApproval(context);
  await review.click();
  const approval = await approvalP;
  await expect(approval.getByRole('button', { name: /^Sign/ })).toBeVisible();
  await expect(approval.getByText(/Simulating/)).toHaveCount(0, { timeout: 30_000 });
  const ack = approval.getByLabel('I understand I may lose these funds');
  if (await ack.count()) await ack.check();
  await decideAndClose(approval, /^Sign( anyway)?$/);

  await expect(popup.getByText('Sent', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await rpcCall<{ value: number }>(validator, 'getBalance', [to, { commitment: 'confirmed' }])).value, { timeout: 30_000 })
    .toBe(before + SOL / 2);

  // History: the sent transaction opens its detail, explained like the approval but from the chain.
  await popup.reload();
  await popup.getByRole('navigation', { name: 'Wallet actions' }).getByRole('button', { name: 'History' }).click();
  const row = popup.getByRole('button', { name: /^Details of Sent to / }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const detailP = context.waitForEvent('page', { predicate: (p) => p.url().includes('/transaction.html') });
  await row.click();
  const detail = await detailP;
  await expect(detail.getByText(/^Confirmed · /)).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByText(/0\.5 SOL/).first()).toBeVisible();
  await expect(detail.getByRole('button', { name: /^Sign/ })).toHaveCount(0);
  await detail.getByRole('radio', { name: /Expert/ }).click();
  await expect(detail.getByRole('heading', { name: 'Transaction logs' })).toBeVisible();
});
