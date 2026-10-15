import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryChainReader, type ChainReader, type TxMeta } from '@clef/rpc';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64Decoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import { run, writeFileAtomic, type RunDeps } from '../src/run';

const ME = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const UNKNOWN_PROGRAM = address('6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB');
const SYSTEM = address('11111111111111111111111111111111');
const SIG = '2h8s8iiZHA4xCDrhUZsue2sDtZEs8mZ19b9ryRoEhNoB9biNMHieKk4nknY4vuLbAAkTS3H7uV8sUScgfPY86geE';
const SOL = 1_000_000_000n;

function wire(instructions: Instruction[], feePayer: Address = ME): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k' as Blockhash, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

function transferSol(lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return { programAddress: SYSTEM, accounts: [{ address: ME, role: AccountRole.WRITABLE_SIGNER }, { address: OTHER, role: AccountRole.WRITABLE }], data };
}

const opaque: Instruction = { programAddress: UNKNOWN_PROGRAM, accounts: [{ address: ME, role: AccountRole.WRITABLE_SIGNER }, { address: OTHER, role: AccountRole.WRITABLE }], data: new Uint8Array([9]) };

/** Landed tx: account order is fee payer, OTHER, then the program. */
function meta(pre: bigint[], post: bigint[]): TxMeta {
  return { err: null, fee: 5000n, preBalances: pre, postBalances: post, preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] }, logMessages: [] };
}

/** A small, fully explained transfer (no danger). */
function safeReader(): MemoryChainReader {
  const reader = new MemoryChainReader();
  reader.transactions.set(SIG, { wire: wire([transferSol(SOL / 100n)]), meta: meta([10n * SOL, SOL, 1n], [10n * SOL - SOL / 100n - 5000n, SOL + SOL / 100n, 1n]), slot: 1n, blockTime: null });
  return reader;
}

/** An undecodable program drains 5 SOL from the fee payer: unexplained-outflow danger. */
function dangerReader(): MemoryChainReader {
  const reader = new MemoryChainReader();
  reader.transactions.set(SIG, { wire: wire([opaque]), meta: meta([10n * SOL, SOL, 1n], [5n * SOL - 5000n, 6n * SOL, 1n]), slot: 1n, blockTime: null });
  return reader;
}

function harness(reader: ChainReader, overrides: Partial<RunDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const writes: { path: string; data: string }[] = [];
  const deps: RunDeps = {
    makeReader: () => reader,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    writeFile: (path, data) => writes.push({ path, data }),
    ...overrides,
  };
  return { deps, out, err, writes, stdout: () => out.join('\n'), stderr: () => err.join('\n') };
}

describe('run', () => {
  it('exits 0 for an explained transaction without danger', async () => {
    const h = harness(safeReader());
    expect(await run(['explain', SIG, '--me', ME], {}, h.deps)).toBe(0);
    expect(h.stdout()).toContain('Send 0.01 SOL');
    expect(h.stdout()).not.toContain('No --me given');
  });

  it('exits 3 when a danger warning is present', async () => {
    const h = harness(dangerReader());
    expect(await run(['explain', SIG, '--me', ME], {}, h.deps)).toBe(3);
    expect(h.stdout()).toContain('DANGER: Funds leave your wallet');
  });

  it('exits 2 on usage errors, before touching the chain', async () => {
    for (const argv of [[], ['explain'], ['explain', 'not-a-signature'], ['explain', '--tx', '!!!'], ['explain', SIG, '--level', 'max'], ['explain', SIG, '--me', 'nope']]) {
      const h = harness({} as ChainReader, { makeReader: () => { throw new Error('must not connect'); } });
      expect(await run(argv, {}, h.deps)).toBe(2);
      expect(h.out).toEqual([]);
    }
  });

  it('exits 1 when the transaction is missing or the chain fails, with the error cleaned', async () => {
    const missing = harness(new MemoryChainReader());
    expect(await run(['explain', SIG], {}, missing.deps)).toBe(1);
    expect(missing.stderr()).toContain('not found');

    const hostile = new MemoryChainReader();
    hostile.getTransaction = async () => { throw new Error('boom\u001b]0;pwned\u0007\u001b[2J\u202e\r\nfake prompt$ '); };
    const h = harness(hostile);
    expect(await run(['explain', SIG], {}, h.deps)).toBe(1);
    expect(h.stderr()).toContain('boom]0;pwned[2Jfake prompt$');
    expect(h.stderr()).not.toMatch(new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u202e]'));
  });

  describe('without --me', () => {
    for (const level of ['basic', 'intermediate'] as const) {
      it(`assumes the fee payer and says so (${level})`, async () => {
        const h = harness(dangerReader());
        expect(await run(['explain', SIG, '--level', level], {}, h.deps)).toBe(3);
        const out = h.stdout();
        expect(out).toContain(`No --me given: assuming you are the fee payer ${ME}. Pass --me to check other wallets.`);
        // The fee payer's own losses are judged and shown.
        expect(out).toContain('DANGER: Funds leave your wallet');
        expect(out).toContain('-5.000005 SOL');
        expect(out).not.toContain('Balance changes for your wallets: none');
        expect(out.indexOf('No --me given')).toBeLessThan(out.indexOf('Balance changes'));
      });
    }

    it('takes the fee payer from a --tx wire as well', async () => {
      const reader = new MemoryChainReader();
      const tx = getBase64Decoder().decode(wire([transferSol(SOL / 100n)], OTHER));
      const h = harness(reader);
      await run(['explain', '--tx', tx], {}, h.deps);
      expect(h.stdout()).toContain(`assuming you are the fee payer ${OTHER}`);
    });
  });

  describe('--record', () => {
    it('writes the fixture after the output on success', async () => {
      const h = harness(safeReader());
      const order: string[] = [];
      h.deps.out = (s) => order.push(`out:${s.slice(0, 10)}`);
      h.deps.err = (s) => order.push(`err:${s}`);
      expect(await run(['explain', SIG, '--me', ME, '--record', 'fx.json'], {}, h.deps)).toBe(0);
      expect(h.writes).toHaveLength(1);
      expect(h.writes[0]!.path).toBe('fx.json');
      expect(JSON.parse(h.writes[0]!.data)).toMatchObject({ version: 1, input: { signature: SIG, me: [ME], labels: {} } });
      expect(order.at(-1)).toContain('Recorded fixture');
      expect(order.findIndex((s) => s.startsWith('err:'))).toBeGreaterThan(order.findIndex((s) => s.startsWith('out:')));
    });

    it('does not write (or overwrite) the fixture when explaining fails', async () => {
      const h = harness(new MemoryChainReader());
      expect(await run(['explain', SIG, '--record', 'fx.json'], {}, h.deps)).toBe(1);
      expect(h.writes).toEqual([]);
      expect(h.stderr()).not.toContain('Recorded');
    });

    it('reports a failed write without masking the exit code', async () => {
      for (const [reader, code] of [[safeReader(), 0], [dangerReader(), 3]] as const) {
        const h = harness(reader, { writeFile: () => { throw new Error('EACCES\u001b[2J'); } });
        expect(await run(['explain', SIG, '--me', ME, '--record', '/nope/fx.json'], {}, h.deps)).toBe(code);
        expect(h.stderr()).toContain('Could not write fixture /nope/fx.json: EACCES[2J');
        expect(h.stdout()).toContain('0'); // the explanation itself was printed
      }
    });
  });

  describe('writeFileAtomic', () => {
    it('replaces the target and leaves no temp file', () => {
      const dir = mkdtempSync(join(tmpdir(), 'clef-'));
      const target = join(dir, 'fx.json');
      writeFileSync(target, 'old');
      writeFileAtomic(target, 'new');
      expect(readFileSync(target, 'utf8')).toBe('new');
      expect(readdirSync(dir)).toEqual(['fx.json']);
    });

    it('throws without touching anything when the directory is missing', () => {
      const dir = mkdtempSync(join(tmpdir(), 'clef-'));
      expect(() => writeFileAtomic(join(dir, 'missing', 'fx.json'), 'x')).toThrow();
      expect(existsSync(join(dir, 'missing'))).toBe(false);
    });
  });
});
