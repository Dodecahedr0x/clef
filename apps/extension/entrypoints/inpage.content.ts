import { registerWallet } from '@wallet-standard/wallet';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { ClefWallet } from '../lib/clef-wallet';
import { pageBridge } from '../lib/page-bridge';

/** Runs in the page's own JS world so dApps can discover Clef through Wallet Standard. Holds no secrets. */
export default defineContentScript({
  matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    registerWallet(new ClefWallet(pageBridge()));
  },
});
