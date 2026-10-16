import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Blockhash,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { describe, expect, inject, it } from 'vitest';
import { fund, fundToken, rpcCall, timeTravel } from './surfpool/cheats';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const url = inject('surfpoolRpcUrl');

describe('surfpool local validator', () => {
  it('is healthy', async () => {
    expect(await rpcCall(url, 'getHealth')).toBe('ok');
  });

  it('funds SOL and USDC through cheatcodes', async () => {
    const owner = await generateKeyPairSigner();
    await fund(url, owner.address, 3_000_000_000n);
    expect(await rpcCall<{ value: number }>(url, 'getBalance', [owner.address])).toMatchObject({ value: 3_000_000_000 });

    await fundToken(url, owner.address, USDC, 1_500_000n);
    const res = await rpcCall<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(
      url,
      'getTokenAccountsByOwner',
      [owner.address, { mint: USDC }, { encoding: 'jsonParsed' }],
    );
    expect(res.value[0]?.account.data.parsed.info.tokenAmount.amount).toBe('1500000');
  });

  it('loads snapshot programs as executable', async () => {
    for (const program of ['SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4']) {
      const res = await rpcCall<{ value: { executable: boolean } | null }>(url, 'getAccountInfo', [program, { encoding: 'base64' }]);
      expect(res.value?.executable, program).toBe(true);
    }
  });

  it('simulates a bundle', async () => {
    const payer = await generateKeyPairSigner();
    const to = await generateKeyPairSigner();
    await fund(url, payer.address, 1_000_000_000n);
    const { value: latest } = await rpcCall<{ value: { blockhash: Blockhash; lastValidBlockHeight: number } }>(url, 'getLatestBlockhash');
    const tx = await signTransactionMessageWithSigners(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(payer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.blockhash, lastValidBlockHeight: BigInt(latest.lastValidBlockHeight) }, m),
        (m) => appendTransactionMessageInstruction(getTransferSolInstruction({ source: payer, destination: to.address, amount: lamports(10_000_000n) }), m),
      ),
    );
    const res = await rpcCall<{ value: { summary: unknown; transactionResults: { err: unknown }[] } }>(url, 'simulateBundle', [
      { encodedTransactions: [getBase64EncodedWireTransaction(tx)] },
      { preExecutionAccountsConfigs: [null], postExecutionAccountsConfigs: [{ addresses: [to.address], encoding: 'base64' }], skipSigVerify: false, replaceRecentBlockhash: false },
    ]);
    expect(res.value.summary).toBe('succeeded');
    expect(res.value.transactionResults).toHaveLength(1);
  });

  it('time travels', async () => {
    const before = await rpcCall<number>(url, 'getSlot', [{ commitment: 'processed' }]);
    await timeTravel(url, before + 10_000);
    expect(await rpcCall<number>(url, 'getSlot', [{ commitment: 'processed' }])).toBeGreaterThanOrEqual(before + 10_000);
  });
});
