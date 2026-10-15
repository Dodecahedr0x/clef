import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64Decoder,
  getBase64Encoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  verifySignature,
  type Blockhash,
} from '@solana/kit';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a long password';
const A = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

declare global {
  interface Window {
    clef(): any;
    events: string[][];
    fromB64(s: string): Uint8Array;
    toB64(b: Uint8Array): string;
    verify(pub: Uint8Array, sig: Uint8Array, msg: Uint8Array): Promise<boolean>;
  }
}

const nextApproval = (context: BrowserContext) =>
  context.waitForEvent('page', { predicate: (p) => p.url().includes('/approval.html') });

function transferWire(): string {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(A, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k' as Blockhash, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions([getTransferSolInstruction({ source: createNoopSigner(A), destination: OTHER, amount: 1n })], m),
  );
  return getBase64Decoder().decode(getTransactionEncoder().encode(compileTransaction(message)));
}

/** Clicks a button that decides the request; the approval window closes itself right after. */
async function decideAndClose(page: Page, name: string): Promise<void> {
  const closed = page.waitForEvent('close');
  await page.getByRole('button', { name }).click({ noWaitAfter: true }).catch(() => {});
  await closed;
}

/** Starts a signMessage in the dApp; resolves with the verification result, or the error code if it failed. */
const signMessage = (dapp: Page) =>
  dapp.evaluate(async () => {
    const wallet = window.clef();
    const account = wallet.accounts[0];
    const message = new TextEncoder().encode('hello');
    try {
      const [out] = await wallet.features['solana:signMessage'].signMessage({ account, message });
      return { verified: await window.verify(account.publicKey, out.signature, message) };
    } catch (e) {
      return { code: (e as { code?: number }).code };
    }
  });

test('onboard, connect, sign, reject, lock and disconnect', async ({ context, popup, dapp, base }) => {
  // 1. Import the wallet from the popup and point it at the stub RPC.
  await popup.getByRole('button', { name: 'Import a recovery phrase' }).click();
  await popup.locator('textarea').fill(ABANDON);
  await popup.getByLabel('Password (at least 8 characters)').fill(PASSWORD);
  await popup.getByLabel('Confirm password').fill(PASSWORD);
  await popup.getByRole('button', { name: 'Import wallet' }).click();
  await expect(popup.getByText('HAgk...KpqK')).toBeVisible();
  await popup.getByRole('button', { name: 'Settings' }).click();
  await popup.getByLabel('RPC URL').fill(`${base}/rpc`);
  await popup.getByRole('button', { name: 'Save' }).click();
  await expect(popup.getByRole('button', { name: 'Saved' })).toBeVisible();
  await popup.getByRole('button', { name: 'Back' }).click();

  // 2. The dApp discovers Clef through Wallet Standard.
  await dapp.reload();
  expect(await dapp.evaluate(() => Boolean(window.clef()))).toBe(true);

  // 3. Connect.
  const connected = dapp.evaluate(async () => {
    const wallet = window.clef();
    wallet.features['standard:events'].on('change', ({ accounts }: { accounts: { address: string }[] }) =>
      window.events.push(accounts.map((a) => a.address)),
    );
    const { accounts } = await wallet.features['standard:connect'].connect();
    return accounts.map((a: { address: string }) => a.address);
  });
  const connectApproval = await nextApproval(context);
  await expect(connectApproval.getByText('127.0.0.1')).toBeVisible();
  await decideAndClose(connectApproval, 'Connect');
  expect(await connected).toEqual([A]);

  // 4. Sign a message; the signature verifies in the page.
  const signed = signMessage(dapp);
  const messageApproval = await nextApproval(context);
  await expect(messageApproval.getByText('hello')).toBeVisible();
  await decideAndClose(messageApproval, 'Approve');
  expect(await signed).toEqual({ verified: true });

  // 5. Sign a transaction; the explanation renders (the stub RPC fails, so it may require acknowledgement).
  const wire = transferWire();
  const signedTx = dapp.evaluate(async (b64) => {
    const wallet = window.clef();
    const [out] = await wallet.features['solana:signTransaction'].signTransaction({
      account: wallet.accounts[0],
      transaction: window.fromB64(b64),
      chain: 'solana:mainnet',
    });
    return window.toB64(out.signedTransaction);
  }, wire);
  const txApproval = await nextApproval(context);
  await expect(txApproval.getByText('Review transaction')).toBeVisible();
  await expect(txApproval.getByText('Explaining...')).toHaveCount(0, { timeout: 30_000 });
  const ack = txApproval.getByLabel('I understand the risks and want to continue anyway.');
  if (await ack.count()) await ack.check();
  await decideAndClose(txApproval, 'Approve');
  const tx = getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(await signedTx)));
  const signature = tx.signatures[A];
  expect(signature).toBeTruthy();
  expect(await verifySignature(await getPublicKeyFromAddress(A), signature!, tx.messageBytes)).toBe(true);

  // 6. Closing the approval window rejects with 4001.
  const rejected = signMessage(dapp);
  (await nextApproval(context)).close();
  expect(await rejected).toEqual({ code: 4001 });

  // 7. Lock from the popup: the next request asks to unlock first.
  await popup.reload();
  await popup.getByRole('button', { name: 'Lock' }).click();
  await expect(popup.getByRole('button', { name: 'Unlock' })).toBeVisible();
  const whileLocked = signMessage(dapp);
  const lockedApproval = await nextApproval(context);
  await expect(lockedApproval.getByRole('button', { name: 'Unlock' })).toBeVisible();
  await lockedApproval.close();
  expect(await whileLocked).toEqual({ code: 4001 });

  // 8. Disconnect the site from the popup's settings: the dApp hears accounts = [].
  await popup.getByLabel('Password').fill(PASSWORD);
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await popup.getByRole('button', { name: 'Settings' }).click();
  await popup.getByRole('button', { name: 'Disconnect' }).click();
  await expect.poll(() => dapp.evaluate(() => window.events.at(-1))).toEqual([]);
});
