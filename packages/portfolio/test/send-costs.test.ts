import { describe, expect, it } from 'vitest';
import { address } from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';
import { MemoryChainReader } from '@clef/rpc';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '@clef/explain';
import { SIGNATURE_FEE, WALLET_RENT_MIN, hasTokenAccount, maxSolSend, sendCosts, tokenAccountRent } from '../src/send-costs';

const SOL = 1_000_000_000n;
const OWNER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

describe('send costs', () => {
  it('uses the runtime rent figures', () => {
    expect(WALLET_RENT_MIN).toBe(890_880n);
    expect(tokenAccountRent('token')).toBe(2_039_280n);
    expect(tokenAccountRent('token-2022')).toBe(2_074_080n);
  });

  it('MAX on SOL sends everything but the fee, emptying the wallet', () => {
    expect(maxSolSend(SOL)).toBe(SOL - SIGNATURE_FEE);
    expect(maxSolSend(3_000n)).toBe(0n);
    expect(sendCosts({ asset: 'sol', amount: maxSolSend(SOL), solBalance: SOL }).problem).toBeNull();
  });

  it('refuses a SOL send that leaves no room for the fee', () => {
    expect(sendCosts({ asset: 'sol', amount: SOL, solBalance: SOL }).problem).toEqual({ kind: 'fee', need: SIGNATURE_FEE, have: 0n });
  });

  it('refuses a SOL send that leaves less than a wallet must hold', () => {
    // The old MAX: everything but 10,000 lamports, which leaves 5,000 after the fee.
    expect(sendCosts({ asset: 'sol', amount: SOL - 10_000n, solBalance: SOL }).problem).toEqual({ kind: 'dust', left: 5_000n });
    expect(sendCosts({ asset: 'sol', amount: SOL - SIGNATURE_FEE - WALLET_RENT_MIN, solBalance: SOL }).problem).toBeNull();
  });

  it('refuses SOL to a new address below what opens it', () => {
    expect(sendCosts({ asset: 'sol', amount: 100_000n, solBalance: SOL, recipientIsNew: true }).problem).toEqual({ kind: 'recipient-min', min: WALLET_RENT_MIN });
    expect(sendCosts({ asset: 'sol', amount: WALLET_RENT_MIN, solBalance: SOL, recipientIsNew: true }).problem).toBeNull();
    expect(sendCosts({ asset: 'sol', amount: 100_000n, solBalance: SOL, recipientIsNew: false }).problem).toBeNull();
  });

  it('a token send needs SOL for the fee, plus the deposit when it opens the recipient account', () => {
    expect(sendCosts({ asset: 'token', amount: 5n, solBalance: 0n }).problem).toEqual({ kind: 'fee', need: SIGNATURE_FEE, have: 0n });
    const deposit = tokenAccountRent('token');
    const c = sendCosts({ asset: 'token', amount: 5n, solBalance: SOL / 1000n, deposit });
    expect(c).toEqual({ fee: SIGNATURE_FEE, deposit, problem: { kind: 'fee', need: SIGNATURE_FEE + deposit, have: SOL / 1000n } });
    expect(sendCosts({ asset: 'token', amount: 5n, solBalance: SOL / 100n, deposit }).problem).toBeNull();
    // The fee alone would take a wallet just above the minimum below it.
    expect(sendCosts({ asset: 'token', amount: 5n, solBalance: WALLET_RENT_MIN }).problem).toEqual({ kind: 'dust', left: WALLET_RENT_MIN - SIGNATURE_FEE });
  });
});

describe('hasTokenAccount', () => {
  it('looks up the associated token account under the mint program', async () => {
    const chain = new MemoryChainReader();
    expect(await hasTokenAccount(chain, OWNER, MINT, 'token')).toBe(false);
    const [ata] = await findAssociatedTokenPda({ owner: OWNER, mint: MINT, tokenProgram: address(TOKEN_PROGRAM) });
    chain.setAccount({ address: ata, owner: address(TOKEN_PROGRAM), lamports: 2_039_280n, data: new Uint8Array(165), executable: false });
    expect(await hasTokenAccount(chain, OWNER, MINT, 'token')).toBe(true);
    // The Token-2022 address differs: not found.
    expect(await hasTokenAccount(chain, OWNER, MINT, 'token-2022')).toBe(false);
    expect(TOKEN_2022_PROGRAM).not.toBe(TOKEN_PROGRAM);
  });
});
