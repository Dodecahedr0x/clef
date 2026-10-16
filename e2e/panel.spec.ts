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
