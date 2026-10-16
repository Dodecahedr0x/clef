import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { startSurfpool } from './surfpool';

const EXTENSION = join(import.meta.dirname, '..', 'apps', 'extension', '.output', 'chrome-mv3');
const DAPP = readFileSync(join(import.meta.dirname, 'dapp', 'index.html'), 'utf8');

/** Serves the test dApp at / and a JSON-RPC stub at /rpc that fails every call (explanations then fail closed). */
async function startServer(): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/rpc') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let id: unknown = 1;
        try {
          id = (JSON.parse(body) as { id?: unknown }).id ?? 1;
        } catch {
          /* keep default id */
        }
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'stub' } }));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(DAPP);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return { server, base: `http://127.0.0.1:${port}` };
}

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  /** Origin serving the test dApp (and the stub RPC at /rpc). */
  base: string;
  /** JSON-RPC endpoint that fails every call, so explanations fail closed. */
  stubRpc: string;
  popup: Page;
  dapp: Page;
};
/** RPC URL of an offline surfpool validator (snapshot preloaded), shared by the worker's tests. */
type WorkerFixtures = { validator: string };

export const test = base.extend<Fixtures, WorkerFixtures>({
  validator: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const surfpool = await startSurfpool();
      try {
        await use(surfpool.url);
      } finally {
        await surfpool.stop();
      }
    },
    { scope: 'worker' },
  ],
  // eslint-disable-next-line no-empty-pattern
  base: async ({}, use) => {
    const { server, base: url } = await startServer();
    await use(url);
    server.close();
  },
  stubRpc: async ({ base: url }, use) => use(`${url}/rpc`),
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
  popup: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await use(page);
  },
  dapp: async ({ context, base: url }, use) => {
    const page = await context.newPage();
    await page.goto(`${url}/`);
    await use(page);
  },
});

export { expect } from '@playwright/test';
