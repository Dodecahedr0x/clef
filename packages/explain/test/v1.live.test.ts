import { createDefaultResolver, UserIdlSource } from '@clef/idl';
import { KitChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionEncoder,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { explain } from '../src';

// Surfpool cannot parse v1 transactions, so the over-1232-byte path is checked against devnet (read only: simulated, never sent).
const DEVNET = 'https://api.devnet.solana.com';
const PAYER = address('5Hs51hUxpr9cBz8gwbsFNVcJqdtPeJR8MoUNxoUSGP8a');

describe.skipIf(!process.env.CLEF_LIVE_DEVNET)('v1 transactions over the legacy size (live devnet)', () => {
  it('explains and simulates a ~2.9 KB v1 transaction', async () => {
    const reader = new KitChainReader(DEVNET);
    const latest = await fetch(DEVNET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' }) });
    const { value } = ((await latest.json()) as { result: { value: { blockhash: Blockhash; lastValidBlockHeight: number } } }).result;
    const blockhash = value.blockhash;
    const lastValidBlockHeight = BigInt(value.lastValidBlockHeight);
    const to = await Promise.all(Array.from({ length: 55 }, async () => (await generateKeyPairSigner()).address));
    const message = pipe(
      createTransactionMessage({ version: 1 }),
      (m) => setTransactionMessageFeePayer(PAYER, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
      (m) => appendTransactionMessageInstructions(to.map((d) => getTransferSolInstruction({ source: createNoopSigner(PAYER), destination: d, amount: 1_000_000n })), m),
      (m) => setTransactionMessageConfig({ computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 1_000_000 }, m),
    );
    const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
    expect(wire.length).toBeGreaterThan(1232);
    expect(wire.length).toBeLessThanOrEqual(4096);

    const ex = await explain({ wire }, { reader, idls: createDefaultResolver(reader, new UserIdlSource()), me: [PAYER] });
    expect(ex.instructions).toHaveLength(55);
    expect(ex.warnings.map((w) => w.rule)).not.toContain('simulation-failed');
    expect(ex.balanceChanges?.find((c) => c.owner === PAYER)?.delta).toBeLessThan(-55_000_000n);
    expect(ex.computeUnits).toBeGreaterThan(0n);
  }, 60_000);
});
