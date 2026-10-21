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

  const ack = approval.getByLabel(/^I understand/);
  if (await ack.count()) await ack.check();
  await decideAndClose(approval, /^Sign all 3/);
  const out = (await signed) as { signedTransactions?: string[] };
  expect(out.signedTransactions).toHaveLength(3);
  for (const b64 of out.signedTransactions!) await verifySigned(b64);
});

test('a narrowed approval window reflows: no sideways scroll, Sign stays reachable, Expert sections in a select', async ({ context, popup, dapp, base, validator }) => {
  await setup({ context, popup, dapp, base, validator }, 'basic');
  const signed = run(dapp, 'signBatch');
  const approval = await nextApproval(context);
  const overflow = () => approval.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const level = approval.getByRole('radiogroup', { name: 'Detail level' });

  await approval.setViewportSize({ width: 200, height: 680 });
  await expect(approval.getByText('3 transactions, signed together')).toBeVisible({ timeout: 30_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(approval.getByRole('button', { name: /^Sign all 3/ })).toBeInViewport();
  // No text drawn over other text: the balance rows wrap, and the header clears the test-network tag.
  const overlaps = await approval.evaluate(() => {
    // Where each run of text is drawn (a Range), not its element's box: overflowing text spills outside its box.
    const root = '[aria-labelledby="basic-bc"], header, [data-testid="network-edge"]';
    const runs = Array.from(document.querySelectorAll(root)).flatMap((el) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const out: { node: Node; text: string; r: DOMRect }[] = [];
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of Array.from(range.getClientRects())) if (r.width && r.height) out.push({ node: n, text: n.textContent!.trim(), r });
      }
      return out;
    });
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    return runs.flatMap((a, i) => runs.slice(i + 1).filter((b) => b.node !== a.node && hit(a.r, b.r)).map((b) => `${a.text} × ${b.text}`));
  });
  expect(overlaps).toEqual([]);
  await level.getByRole('radio', { name: 'Expert' }).click();
  await approval.setViewportSize({ width: 380, height: 960 });
  await expect(approval.getByRole('heading', { name: 'Request details' })).toBeAttached({ timeout: 30_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(approval.getByRole('navigation', { name: 'Transaction sections' })).toBeHidden();
  await expect(approval.getByLabel('Jump to')).toBeVisible();
  await expect(approval.getByRole('button', { name: /^Sign all 3/ })).toBeInViewport();
  await expect(level).toBeInViewport();

  await decideAndClose(approval, 'Reject all');
  expect(await signed).toMatchObject({ code: 4001 });
});

test('signMessage shows the text and verifies; a tx look-alike is blocked', async ({ context, popup, dapp, base, validator }) => {
  await setup({ context, popup, dapp, base, validator });

  const signed = run(dapp, 'signMessage');
  const approval = await nextApproval(context);
  await expect(approval.getByText('Hello from the Clef test dApp')).toBeVisible();
  await expect(approval.getByText('Readable text, not a hidden transaction')).toBeVisible();
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

  // A test network is marked on every screen and in the approval, which names the network read-only.
  await expect(popup.getByRole('note', { name: 'Test network: Localnet' })).toBeVisible();
  await popup.getByRole('navigation', { name: 'Wallet actions' }).getByRole('button', { name: 'Send' }).click();
  await expect(popup.getByRole('note', { name: 'Test network: Localnet' })).toBeVisible();
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
  await expect(approval.getByRole('note', { name: 'Test network: Localnet' })).toBeVisible();
  await approval.getByRole('radio', { name: 'Expert' }).click();
  await expect(approval.getByText(/Simulating/)).toHaveCount(0, { timeout: 30_000 });
  await expect(approval.getByRole('img', { name: 'Network: Localnet' })).toBeVisible();
  await expect(approval.getByRole('radiogroup', { name: 'Network' })).toHaveCount(0);
  const ack = approval.getByLabel(/^I understand/);
  if (await ack.count()) await ack.check();
  await decideAndClose(approval, /^Sign( anyway)?$/);

  // "Sent" only once the validator confirms it; no public explorer sees localnet.
  await expect(popup.getByText('Sent', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(popup.getByText('Confirmed by the network.')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'View on explorer' })).toHaveCount(0);
  await expect
    .poll(async () => (await rpcCall<{ value: number }>(validator, 'getBalance', [to, { commitment: 'confirmed' }])).value, { timeout: 30_000 })
    .toBe(before + SOL / 2);

  // History: the sent transaction opens its detail, explained like the approval but from the chain.
  await popup.reload();
  await popup.getByRole('navigation', { name: 'Wallet actions' }).getByRole('button', { name: 'History' }).click();
  const row = popup.getByRole('button', { name: /Sent to / }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  const detail = popup;
  await expect(detail.getByText(/^Confirmed · /)).toBeVisible({ timeout: 30_000 });
  // The real date, not 1970 (surfpool's getTransaction reports block time divided by 1000).
  await expect(detail.getByText(new RegExp(`^Confirmed · .*${new Date().getFullYear()}`))).toBeVisible();
  await expect(detail.getByText(/0\.5 SOL/).first()).toBeVisible();
  await expect(detail.getByRole('button', { name: /^Sign/ })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Continue in a browser tab' })).toBeVisible();
  await detail.getByRole('radio', { name: /Expert/ }).click();
  await expect(detail.getByRole('heading', { name: 'Transaction logs' })).toBeVisible();
  await detail.getByRole('button', { name: 'Back' }).click();
  await expect(row).toBeVisible();
});

test('MAX on SOL sends everything but the fee and empties the account', async ({ context, popup, dapp, base, validator }) => {
  await setup({ context, popup, dapp, base, validator });
  const to = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

  await popup.getByRole('navigation', { name: 'Wallet actions' }).getByRole('button', { name: 'Send' }).click();
  await expect(popup.getByText(/Balance 10/)).toBeVisible({ timeout: 30_000 });
  // Keyboard: the new screen's heading has focus; the token picker is modal, Escape closes it, focus goes back.
  await expect(popup.getByRole('heading', { name: 'Send', level: 1 })).toBeFocused();
  const chooser = popup.getByRole('button', { name: 'Choose token' });
  await chooser.focus();
  await popup.keyboard.press('Enter');
  const picker = popup.getByRole('dialog', { name: 'Choose token' });
  await expect(picker).toBeVisible();
  await expect.poll(() => picker.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await popup.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(chooser).toBeFocused();
  await popup.getByRole('textbox', { name: 'To' }).fill(to);
  await popup.getByRole('button', { name: 'MAX' }).click();
  await expect(popup.getByRole('textbox', { name: 'Amount' })).toHaveValue('9.999995');
  await expect(popup.getByText('Network fee 0.000005 SOL')).toBeVisible();
  const review = popup.getByRole('button', { name: 'Review' });
  await expect(review).toBeEnabled({ timeout: 30_000 });
  const approvalP = nextApproval(context);
  await review.click();
  const approval = await approvalP;
  await expect(approval.getByText(/Simulating/)).toHaveCount(0, { timeout: 30_000 });
  const ack = approval.getByLabel(/^I understand/);
  if (await ack.count()) await ack.check();
  await decideAndClose(approval, /^Sign( anyway)?$/);

  await expect(popup.getByText('Sent', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await rpcCall<{ value: number }>(validator, 'getBalance', [A, { commitment: 'confirmed' }])).value, { timeout: 30_000 }).toBe(0);
  expect((await rpcCall<{ value: number }>(validator, 'getBalance', [to, { commitment: 'confirmed' }])).value).toBe(10 * SOL - 5000);
});
