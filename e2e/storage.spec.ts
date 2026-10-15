/// <reference types="chrome" />
import { expect, test } from './fixtures';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a long password';

test('storage holds only ciphertext, and the wallet survives a service-worker restart', async ({ context, popup, extensionId }) => {
  await popup.getByRole('button', { name: 'Import a recovery phrase' }).click();
  await popup.locator('textarea').fill(ABANDON);
  await popup.getByLabel('Password (at least 8 characters)').fill(PASSWORD);
  await popup.getByLabel('Confirm password').fill(PASSWORD);
  await popup.getByRole('button', { name: 'Import wallet' }).click();
  await expect(popup.getByText('HAgk...KpqK')).toBeVisible();

  // Read both storage areas from an extension page (trusted context).
  const dump = await popup.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
  }));
  const local = JSON.stringify(dump.local);
  expect(Object.keys(dump.local).sort()).toEqual(['accounts', 'vault']);
  expect(local).not.toContain('abandon');
  expect(local).not.toContain(PASSWORD);
  expect(Object.keys(dump.session)).toEqual(['session-key']);

  // Kill the service worker; the next popup load restarts it and the wallet is still unlocked.
  const cdp = await context.newCDPSession(popup);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const fresh = await context.newPage();
  await fresh.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(fresh.getByText('HAgk...KpqK')).toBeVisible();
  await expect(fresh.getByRole('button', { name: 'Lock' })).toBeVisible();

  // Locking removes the session key.
  await fresh.getByRole('button', { name: 'Lock' }).click();
  await expect(fresh.getByRole('button', { name: 'Unlock' })).toBeVisible();
  expect(await fresh.evaluate(() => chrome.storage.session.get(null))).toEqual({});
});
