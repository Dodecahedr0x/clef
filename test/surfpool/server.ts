import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

export const SNAPSHOT = join(import.meta.dirname, 'snapshot.json');

export type Surfpool = { url: string; stop: () => Promise<void> };

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    return ((await res.json()) as { result?: string }).result === 'ok';
  } catch {
    return false;
  }
}

/** Starts an offline surfpool preloaded with the snapshot. surfpool ignores SIGTERM, so stop() sends SIGINT. */
export async function startSurfpool({ timeoutMs = 30_000 }: { timeoutMs?: number } = {}): Promise<Surfpool> {
  const port = await freePort();
  const wsPort = await freePort();
  const url = `http://127.0.0.1:${port}`;
  // --log-path keeps surfpool from writing .surfpool/ into the cwd.
  const child: ChildProcess = spawn(
    'surfpool',
    ['start', '--ci', '--offline', '--no-deploy', '-q', '0', '--port', String(port), '--ws-port', String(wsPort), '--snapshot', SNAPSHOT, '--log-level', 'none'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  let dead = false;
  void exited.then(() => (dead = true));

  const stop = async (): Promise<void> => {
    if (dead) return;
    child.kill('SIGINT');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await exited;
    clearTimeout(timer);
  };

  const deadline = Date.now() + timeoutMs;
  while (!(await healthy(url))) {
    if (dead) throw new Error(`surfpool exited before becoming healthy: ${stderr.trim()}`);
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`surfpool not healthy after ${timeoutMs}ms: ${stderr.trim()}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, stop };
}
