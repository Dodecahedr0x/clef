/// <reference types="chrome" />
import { expect, test } from './fixtures';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a long password';

declare global {
  interface Window {
    run(name: string): Promise<Record<string, unknown>>;
  }
}

test('with the side panel open, approvals show in it and no approval window opens', async ({ context, popup, extensionId, dapp, base, stubRpc }) => {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort());
  await popup.evaluate((rpcUrl) => chrome.runtime.sendMessage({ channel: 'internal', call: { type: 'settings:update', patch: { network: 'localnet', rpcUrl } } }), stubRpc);
  await popup.reload();
  await popup.getByRole('button', { name: 'I already have a wallet' }).click();
  await popup.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await popup.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await popup.getByRole('button', { name: 'Continue' }).click();
  await popup.getByLabel('Recovery phrase (12 or 24 words)').fill(ABANDON);
  await popup.getByRole('button', { name: 'Import 1 account' }).click();
  await expect(popup.getByText('HAgk…Kpqk').first()).toBeVisible();

  // The side panel page (here in a tab: the same page and port as the real panel).
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('button', { name: 'Switch account' })).toBeVisible();

  const windows: string[] = [];
  context.on('page', (p) => windows.push(p.url()));

  await dapp.goto(`${base}/`);
  const connected = dapp.evaluate(() => window.run('connect'));
  const dialog = panel.getByRole('dialog', { name: 'Approval request' });
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  expect(await connected).toEqual({ accounts: ['HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'] });
  await expect(dialog).toHaveCount(0);

  const signed = dapp.evaluate(() => window.run('signMessage'));
  await expect(dialog.getByText('Hello from the Clef test dApp')).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign', exact: true }).click();
  expect(await signed).toEqual({ verified: true });
  await expect(dialog).toHaveCount(0);
  // Back to the wallet in the panel.
  await expect(panel.getByRole('button', { name: 'Switch account' })).toBeVisible();

  expect(windows.filter((u) => u.includes('/approval.html'))).toEqual([]);
});

test('a keypair file chosen in the side panel imports that account', async ({ context, popup, extensionId, stubRpc }) => {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort());
  await popup.evaluate((rpcUrl) => chrome.runtime.sendMessage({ channel: 'internal', call: { type: 'settings:update', patch: { network: 'localnet', rpcUrl } } }), stubRpc);
  await popup.reload();
  await popup.getByRole('button', { name: 'I already have a wallet' }).click();
  await popup.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await popup.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await popup.getByRole('button', { name: 'Continue' }).click();
  await popup.getByLabel('Recovery phrase (12 or 24 words)').fill(ABANDON);
  await popup.getByRole('button', { name: 'Import 1 account' }).click();
  await expect(popup.getByText('HAgk…Kpqk').first()).toBeVisible();

  // The Solana CLI format: [32-byte seed, 32-byte public key] as a JSON array.
  const { keypair, address } = await popup.evaluate(async () => {
    const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = BigInt(`0x${[...pub].map((b) => b.toString(16).padStart(2, '0')).join('')}`);
    let s = '';
    while (n > 0n) {
      s = ALPHABET[Number(n % 58n)] + s;
      n /= 58n;
    }
    return { keypair: JSON.stringify([...pkcs8.slice(-32), ...pub]), address: s };
  });

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Switch account' }).click();
  await panel.getByRole('button', { name: /Add account/ }).click();
  await panel.getByRole('button', { name: /^Import/ }).click();
  await panel.getByRole('radio', { name: /Private key/ }).click();
  await panel.getByLabel('Choose a keypair file').setInputFiles({ name: 'id.json', mimeType: 'application/json', buffer: Buffer.from(keypair) });
  await expect(panel.getByText('Loaded id.json')).toBeVisible();
  await expect(panel.getByText(`Address ${address.slice(0, 4)}…${address.slice(-4)}`)).toBeVisible();
  await panel.getByRole('button', { name: 'Import account' }).click();
  await expect.poll(async () => {
    const r = (await panel.evaluate(() => chrome.runtime.sendMessage({ channel: 'internal', call: { type: 'state' } }))) as { value: { accounts: { address: string }[] } };
    return r.value.accounts.map((a) => a.address);
  }).toContain(address);
});

test('Continue in a browser tab opens the same screen with what was typed', async ({ context, popup, extensionId, stubRpc }) => {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort());
  await popup.evaluate((rpcUrl) => chrome.runtime.sendMessage({ channel: 'internal', call: { type: 'settings:update', patch: { network: 'localnet', rpcUrl } } }), stubRpc);
  await popup.reload();
  await popup.getByRole('button', { name: 'I already have a wallet' }).click();
  await popup.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await popup.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await popup.getByRole('button', { name: 'Continue' }).click();
  await popup.getByLabel('Recovery phrase (12 or 24 words)').fill(ABANDON);
  await popup.getByRole('button', { name: 'Import 1 account' }).click();
  await expect(popup.getByText('HAgk…Kpqk').first()).toBeVisible();

  // From the side panel (here in a tab: the same page), which stays open.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  const to = 'Ct4mVq1nZr8sYw3kXe6hJp2dLb9gTf5cMa7uNo4iQ8xe';
  await panel.getByRole('textbox', { name: 'To' }).fill(to);
  const opened = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Continue in a browser tab' }).click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(new RegExp(`^chrome-extension://${extensionId}/popup\\.html#tab&continue=`));
  await expect(tab.getByRole('heading', { name: 'Send' })).toBeVisible();
  await expect(tab.getByRole('textbox', { name: 'To' })).toHaveValue(to);
  await expect(tab.getByRole('button', { name: 'Continue in a browser tab' })).toHaveCount(0);
  // Back goes where it would have in the panel; a reload starts fresh, at home.
  await expect(tab).toHaveURL(/#tab$/);
  await tab.getByRole('button', { name: 'Back' }).click();
  await expect(tab.getByRole('button', { name: 'Switch account' })).toBeVisible();
  await tab.reload();
  await expect(tab.getByRole('button', { name: 'Switch account' })).toBeVisible();
  expect(panel.isClosed()).toBe(false);
});
