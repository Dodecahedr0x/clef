export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const MEMO_V4_PROGRAM = 'Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH';
export const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';
export const VOTE_PROGRAM = 'Vote111111111111111111111111111111111111111';
export const BPF_UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';
export const RENT_SYSVAR = 'SysvarRent111111111111111111111111111111111';

export const TOKEN_PROGRAMS: ReadonlySet<string> = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);

/** Programs that move stake, votes or program code: an undecoded instruction to them is a danger. */
export const SENSITIVE_PROGRAMS: ReadonlySet<string> = new Set([STAKE_PROGRAM, VOTE_PROGRAM, BPF_UPGRADEABLE_LOADER]);

/** Programs whose instructions are never "the point" of a transaction. */
export const PLUMBING_PROGRAMS: ReadonlySet<string> = new Set([COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM, MEMO_V4_PROGRAM]);

/**
 * Core System and SPL programs (System, Token, Token-2022, Associated Token, Compute Budget, Memo): Clef decodes
 * them with its own curated IDLs. A transaction made only of these can't legitimately be depositing into another
 * program.
 */
export const CORE_PROGRAMS: ReadonlySet<string> = new Set([
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  ATA_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  MEMO_V4_PROGRAM,
]);

/**
 * Programs whose behavior Clef knows independently of any IDL they publish. Security-sensitive: an IDL for a
 * program outside this set is the program describing itself. Review every addition.
 */
export const TRUSTED_PROGRAMS: ReadonlySet<string> = new Set([
  ...CORE_PROGRAMS,
  // reviewed: Jupiter v6 aggregator; swap outflows are expected; balance/sweep rules still apply
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
]);

/**
 * Programs Clef knows by address. Security-relevant, not just names: `isTrustedProgram` accepts a PDA derived
 * under any of these as verified, so every addition needs review.
 *
 * Squads v4 is here (its PDAs are derived under its own fixed address, which is safe to accept) but not in
 * `TRUSTED_PROGRAMS`: Clef does not know its behavior independently of the IDL it publishes, so funds moving
 * through it still get the self-described-program treatment.
 */
export const KNOWN_PROGRAMS: Readonly<Record<string, string>> = {
  [SYSTEM_PROGRAM]: 'System Program',
  [TOKEN_PROGRAM]: 'Token Program',
  [TOKEN_2022_PROGRAM]: 'Token-2022 Program',
  [ATA_PROGRAM]: 'Associated Token Program',
  [COMPUTE_BUDGET_PROGRAM]: 'Compute Budget',
  [MEMO_PROGRAM]: 'Memo Program',
  [MEMO_V4_PROGRAM]: 'Memo Program',
  [STAKE_PROGRAM]: 'Stake Program',
  [VOTE_PROGRAM]: 'Vote Program',
  [BPF_UPGRADEABLE_LOADER]: 'BPF Upgradeable Loader',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter Aggregator v6',
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: 'Squads v4',
};

/**
 * Display names for programs: `KNOWN_PROGRAMS` plus programs Clef only names. Never a source of trust: unlike
 * `KNOWN_PROGRAMS`, these don't vouch for PDA derivations (`isTrustedProgram`) or anything else.
 *
 * Program naming precedence, everywhere (`programDisplay`, `Labeler.label`, `programLabel` in `explain`): these
 * names first; then the user's address book; then, for instructions only, the IDL's own name, qualified with its
 * trust tier. An address book entry can't rename a program Clef knows.
 */
export const PROGRAM_NAMES: Readonly<Record<string, string>> = {
  ...KNOWN_PROGRAMS,
  // Verified 2026-10-15: pump-fun/pump-public-docs idl/pump.json and idl/pump_amm.json; executable on mainnet.
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'pump.fun',
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'PumpSwap',
};

export const KNOWN_MINTS: Readonly<Record<string, { symbol: string; decimals: number }>> = {
  So11111111111111111111111111111111111111112: { symbol: 'wSOL', decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
};

/** Mints whose token accounts hold their amount as lamports (wrapped SOL), for Token and Token-2022. */
export const NATIVE_MINTS: ReadonlySet<string> = new Set([
  'So11111111111111111111111111111111111111112',
  '9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP',
]);

/** The runtime's maximum compute unit limit: a larger requested limit is clamped to it. */
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

export const U64_MAX = (1n << 64n) - 1n;
