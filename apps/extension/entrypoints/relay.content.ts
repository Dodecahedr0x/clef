import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { DAPP_PORT } from '../lib/messages';
import { startRelay } from '../lib/relay';

/** Runs in the extension's isolated world: the only path from a page to the background. */
export default defineContentScript({
  matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  runAt: 'document_start',
  main() {
    startRelay(window, () => browser.runtime.connect({ name: DAPP_PORT }));
  },
});
