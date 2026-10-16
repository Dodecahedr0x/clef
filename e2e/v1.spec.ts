import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getBase64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  verifySignature,
  type Blockhash,
} from '@solana/kit';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fund, rpcCall } from './surfpool';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a long password';
const A = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
const SOL = 1_000_000_000;

declare global {
  interface Window {
    run(name: string): Promise<Record<string, unknown>>;
    wire: string;
  }
}

const nextApproval = (context: BrowserContext) => context.waitForEvent('page', { predicate: (p) => p.url().includes('/approval.html') });
const run = (dapp: Page, name: string) => dapp.evaluate((n) => window.run(n), name);

/** A v1 transaction well over the 1232-byte legacy packet limit: SOL to many fresh accounts. */
async function bigV1(validator: string, recipients: number): Promise<Uint8Array> {
  const { value } = await rpcCall<{ value: { blockhash: string; lastValidBlockHeight: number } }>(validator, 'getLatestBlockhash', []);
  const to = await Promise.all(Array.from({ length: recipients }, async () => (await generateKeyPairSigner()).address));
  const msg = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayer(A, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: value.blockhash as Blockhash, lastValidBlockHeight: BigInt(value.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(to.map((d) => getTransferSolInstruction({ source: createNoopSigner(A), destination: d, amount: 1_000_000n })), m),
  );
  return new Uint8Array(getBase64Encoder().encode(getBase64EncodedWireTransaction(compileTransaction(msg))));
}

async function setup(context: BrowserContext, popup: Page, dapp: Page, base: string, validator: string) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await fund(validator, A, 10 * SOL);
  await popup.evaluate((rpc) => chrome.runtime.sendMessage({ channel: 'internal', call: { type: 'settings:update', patch: { network: 'localnet', rpcUrl: rpc } } }), validator);
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
  const closed = approval.waitForEvent('close');
  await approval.getByRole('button', { name: 'Connect', exact: true }).click({ noWaitAfter: true }).catch(() => {});
  await closed;
  await connected;
}

async function approve(context: BrowserContext, dapp: Page, action: string) {
  const result = run(dapp, action);
  const approval = await nextApproval(context);
  await expect(approval.getByText(/Simulating/)).toHaveCount(0, { timeout: 30_000 });
  // Surfpool predates v1: Clef still decodes all 55 transfers and says why it could not simulate.
  await expect(approval.getByRole('heading', { name: '55 instructions' })).toBeVisible();
  await expect(approval.getByText(/version 1 transactions, up to 4 KB, need an up-to-date RPC/)).toBeVisible();
  const ack = approval.getByLabel(/I understand/);
  if (await ack.count()) await ack.check();
  const closed = approval.waitForEvent('close');
  await approval.getByRole('button', { name: /^Sign( anyway)?$/ }).click({ noWaitAfter: true }).catch(() => {});
  await closed;
  return result;
}

// Surfpool 1.4 cannot parse v1 transactions, so this checks decoding, the approval and signing; simulation and sending
// of large v1 transactions are covered against devnet by packages/explain/test/v1.live.test.ts.
test('a v1 transaction over the legacy size limit is decoded, approved and signed', async ({ context, popup, dapp, base, validator }) => {
  await setup(context, popup, dapp, base, validator);
  const wire = await bigV1(validator, 55);
  expect(wire.length).toBeGreaterThan(1232);
  expect(wire.length).toBeLessThanOrEqual(4096);
  await dapp.evaluate((w) => (window.wire = w), btoa(String.fromCharCode(...wire)));

  const signed = (await approve(context, dapp, 'signWire')) as { signed: string };
  const tx = getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(signed.signed)));
  expect(new Uint8Array(tx.messageBytes)).toEqual(new Uint8Array(getTransactionDecoder().decode(wire).messageBytes));
  expect(await verifySignature(await getPublicKeyFromAddress(A), tx.signatures[A]!, tx.messageBytes)).toBe(true);
});
