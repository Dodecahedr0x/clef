/// <reference types="chrome" />
import { expect, test } from './fixtures';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a long password 42';

test('storage holds only ciphertext, and the wallet survives a service-worker restart', async ({ context, popup, extensionId, stubRpc }) => {
  // Keep the import screen's balance lookups off the public network.
  await popup.evaluate(
    (rpcUrl) => chrome.runtime.sendMessage({ channel: 'internal', call: { type: 'settings:update', patch: { network: 'localnet', rpcUrl } } }),
    stubRpc,
  );
  await popup.reload();
  await popup.getByRole('button', { name: 'I already have a wallet' }).click();
  await popup.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await popup.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await popup.getByRole('button', { name: 'Continue' }).click();
  await popup.getByLabel('Recovery phrase (12 or 24 words)').fill(ABANDON);
  await popup.getByRole('button', { name: 'Import 1 account' }).click();
  await expect(popup.getByRole('button', { name: 'Switch account' })).toContainText('HAgk…Kpqk');

  // Read both storage areas from an extension page (trusted context).
  const dump = await popup.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
  }));
  const local = JSON.stringify(dump.local);
  expect(Object.keys(dump.local)).toEqual(expect.arrayContaining(['accounts', 'vault']));
  for (const word of ['abandon', 'about', PASSWORD]) expect(local).not.toContain(word);
  expect(Object.keys(dump.session)).toEqual(['session-key']);
  expect(JSON.stringify(dump.session)).not.toContain('abandon');

  // Kill the service worker; the next popup load restarts it and the wallet is still unlocked.
  const cdp = await context.newCDPSession(popup);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const fresh = await context.newPage();
  await fresh.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(fresh.getByRole('button', { name: 'Switch account' })).toContainText('HAgk…Kpqk');

  // Locking removes the session key.
  await fresh.getByRole('button', { name: 'Settings' }).click();
  await fresh.getByRole('button', { name: 'Lock now' }).click();
  await expect(fresh.getByRole('button', { name: 'Unlock' })).toBeVisible();
  expect(await fresh.evaluate(() => chrome.storage.session.get(null))).toEqual({});
});
