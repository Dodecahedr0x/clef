import type { ChainReader } from '@clef/rpc';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '@clef/explain';
import type { Address } from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';

/** The base fee per signature. Sends built by `buildSendTransaction` carry one signature and no priority fee. */
export const SIGNATURE_FEE = 5_000n;

/** Rent-exempt minimum for `size` bytes of account data (3,480 lamports per byte-year, two years, 128 bytes of header). */
export const rentFor = (size: number) => (128n + BigInt(size)) * 6_960n;

/** A wallet (no data) holds at least this much SOL, or none: the runtime refuses anything in between. */
export const WALLET_RENT_MIN = rentFor(0);

/**
 * The deposit for a recipient's new associated token account: 165 bytes, 170 under Token-2022 (its immutable-owner
 * extension). Mints with more extensions make the account a little bigger; the simulation has the exact figure.
 */
export const tokenAccountRent = (program: 'token' | 'token-2022') => rentFor(program === 'token-2022' ? 170 : 165);

export type SendProblem =
  /** Not enough SOL for the fee (plus the recipient's token account deposit). */
  | { kind: 'fee'; need: bigint; have: bigint }
  /** The wallet would keep some SOL, but less than a wallet must hold. */
  | { kind: 'dust'; left: bigint }
  /** SOL to an address with no account yet, below what opens one. */
  | { kind: 'recipient-min'; min: bigint };

export type SendCosts = { fee: bigint; deposit: bigint; problem: SendProblem | null };

/** What a send costs in SOL on top of the amount, and why it would fail, before anything is built or simulated. */
export function sendCosts(p: {
  asset: 'sol' | 'token';
  amount: bigint;
  solBalance: bigint;
  /** SOL sends: the recipient has no account yet. */
  recipientIsNew?: boolean;
  /** Token sends: the recipient's token account must be created (the sender pays its deposit). */
  deposit?: bigint;
}): SendCosts {
  const fee = SIGNATURE_FEE;
  const deposit = p.asset === 'token' ? (p.deposit ?? 0n) : 0n;
  const out = (p.asset === 'sol' ? p.amount : 0n) + fee + deposit;
  let problem: SendProblem | null = null;
  if (out > p.solBalance) problem = { kind: 'fee', need: fee + deposit, have: p.solBalance - (p.asset === 'sol' ? p.amount : 0n) };
  else if (p.solBalance - out > 0n && p.solBalance - out < WALLET_RENT_MIN) problem = { kind: 'dust', left: p.solBalance - out };
  else if (p.asset === 'sol' && p.recipientIsNew && p.amount < WALLET_RENT_MIN) problem = { kind: 'recipient-min', min: WALLET_RENT_MIN };
  return { fee, deposit, problem };
}

/** MAX for a SOL send: everything but the fee, which empties the wallet (allowed, unlike leaving dust). */
export const maxSolSend = (balance: bigint) => (balance > SIGNATURE_FEE ? balance - SIGNATURE_FEE : 0n);

/** Whether `owner` already has its associated token account for `mint` (else a send creates it, at the sender's cost). */
export async function hasTokenAccount(chain: ChainReader, owner: Address, mint: Address, program: 'token' | 'token-2022'): Promise<boolean> {
  const tokenProgram = (program === 'token-2022' ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM) as Address;
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  const [account] = await chain.getAccounts([ata]);
  return account !== null;
}
