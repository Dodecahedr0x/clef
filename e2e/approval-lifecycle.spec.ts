/// <reference types="chrome" />
import { expect, test } from './fixtures';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a long password';

declare global {
  interface Window {
    run(name: string): Promise<Record<string, unknown>>;
  }
}

test('an approval whose request was lost says so, and the site gets an error instead of hanging', async ({ context, popup, dapp, base, stubRpc }) => {
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
  await popup.close();

  await dapp.goto(`${base}/`);
  const approvalP = context.waitForEvent('page', { predicate: (p) => p.url().includes('/approval.html') });
  const connected = dapp.evaluate(() => window.run('connect'));
  const approval = await approvalP;
  await expect(approval.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();

  // The user is in another window long enough for Chrome to stop the idle service worker (Clef keeps it alive
  // while an approval is open; this forces the worst case). The request in it is lost.
  const cdp = await context.newCDPSession(approval);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');

  // The site is told instead of waiting forever...
  expect(await connected).toMatchObject({ message: expect.stringMatching(/Clef restarted before this request was answered/) });
  // ...and the window says so as soon as the user acts, instead of ignoring the click.
  await approval.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(approval.getByText('This request expired')).toBeVisible();
  const closed = approval.waitForEvent('close');
  await approval.getByRole('button', { name: 'Close' }).click();
  await closed;
});

