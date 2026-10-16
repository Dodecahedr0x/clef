import { MemoryStore } from '@clef/vault';
import { describe, expect, it } from 'vitest';
import { REQUEST_LOG_MAX, RequestLog } from '../src/request-log';

const base = { origin: 'https://dapp.example', kind: 'connect' as const, outcome: 'approved' as const, summary: 'Connect', dangerRules: [] };

describe('RequestLog', () => {
  it('keeps the newest 500 entries, newest first, with limit and clear', async () => {
    let t = 0;
    let n = 0;
    const log = new RequestLog(new MemoryStore(), { now: () => ++t, id: () => `id${n++}` });
    for (let i = 0; i < REQUEST_LOG_MAX + 3; i++) await log.add({ ...base, summary: `s${i}` });
    const all = await log.list();
    expect(all).toHaveLength(REQUEST_LOG_MAX);
    expect(all[0]).toMatchObject({ id: `id${REQUEST_LOG_MAX + 2}`, summary: `s${REQUEST_LOG_MAX + 2}`, at: REQUEST_LOG_MAX + 3 });
    expect(all.at(-1)?.summary).toBe('s3');
    expect((await log.list(2)).map((e) => e.summary)).toEqual([`s${REQUEST_LOG_MAX + 2}`, `s${REQUEST_LOG_MAX + 1}`]);
    await log.clear();
    expect(await log.list()).toEqual([]);
  }, 20_000);

  it('sanitizes the summary and round-trips the snapshot', async () => {
    const log = new RequestLog(new MemoryStore());
    const snapshot = { level: 'basic' as const, summary: 'Send 1 SOL', balanceChanges: [{ owner: 'me', asset: 'SOL', amount: '-1' }] };
    const e = await log.add({
      ...base,
      kind: 'signTransactions',
      summary: `evil‮${'x'.repeat(300)}`,
      dangerRules: ['drain'],
      signatures: ['sig'],
      snapshot,
    });
    expect(e.summary.startsWith('evilx')).toBe(true);
    expect(Array.from(e.summary)).toHaveLength(200);
    expect(typeof e.id).toBe('string');
    const [got] = await log.list();
    expect(got).toEqual(e);
    expect(got?.snapshot).toEqual(snapshot);
  });
});
