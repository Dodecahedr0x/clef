import { address, getAddressDecoder, type Address } from '@solana/kit';
import { RpcError, rpcCall, toBig, type FetchFn } from './json-rpc';
import { UnsupportedMethodError } from './types';

export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export type TokenAccountInfo = {
  address: Address;
  mint: Address;
  owner: Address;
  amount: bigint;
  decimals: number;
  program: Address;
  delegate: Address | null;
  delegatedAmount: bigint;
  state: 'initialized' | 'frozen';
};
export type DasAsset = {
  id: Address;
  interface: string;
  name?: string;
  symbol?: string;
  image?: string;
  decimals?: number;
  balance?: bigint;
  tokenProgram?: Address;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
};
export type SignatureInfo = { signature: string; slot: bigint; blockTime: number | null; err: unknown | null };

export interface PortfolioReader {
  getBalance(owner: Address): Promise<bigint>;
  /** Token + Token-2022 accounts, base64-decoded locally. */
  getTokenAccounts(owner: Address): Promise<TokenAccountInfo[]>;
  /** Probes `getAssetsByOwner` once and caches the answer. */
  hasDas(): Promise<boolean>;
  /** Fungibles only; throws `UnsupportedMethodError` without DAS. */
  getAssetsByOwner(owner: Address): Promise<DasAsset[]>;
  getSignatures(address: Address, opts: { before?: string; limit: number }): Promise<SignatureInfo[]>;
  getHealth(): Promise<{ slot: bigint; latencyMs: number }>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }>;
  /** Polls `getSignatureStatuses` (no websockets) until confirmed, failed, or past `lastValidBlockHeight`. */
  confirm(signature: string, lastValidBlockHeight: bigint, opts?: { pollMs?: number }): Promise<'confirmed' | 'failed' | 'expired'>;
}

const TOKEN_ACCOUNT_SIZE = 165;
const MINT_DECIMALS_OFFSET = 44;
const MAX_ACCOUNTS_PER_CALL = 100;
const DAS_PAGE_LIMIT = 1000;
const DAS_MAX_PAGES = 10;
const FUNGIBLE = new Set(['FungibleToken', 'FungibleAsset']);
const DAS_PROBE_OWNER = '11111111111111111111111111111111';

type UiAccount = { data: readonly [string, string]; owner: Address; lamports: number | bigint } | null;
type Ctx<T> = { context: { slot: number | bigint }; value: T };

function b64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

const addrDecoder = getAddressDecoder();
const addrAt = (data: Uint8Array, offset: number) => addrDecoder.decode(data.subarray(offset, offset + 32));
const u64At = (data: Uint8Array, offset: number) => new DataView(data.buffer, data.byteOffset).getBigUint64(offset, true);
const u32At = (data: Uint8Array, offset: number) => new DataView(data.buffer, data.byteOffset).getUint32(offset, true);

/** SPL token account layout (Token-2022 shares the first 165 bytes). Null for uninitialized or short data. */
export function decodeTokenAccount(data: Uint8Array): Omit<TokenAccountInfo, 'address' | 'decimals' | 'program'> | null {
  if (data.length < TOKEN_ACCOUNT_SIZE) return null;
  const state = data[108];
  if (state !== 1 && state !== 2) return null;
  return {
    mint: addrAt(data, 0),
    owner: addrAt(data, 32),
    amount: u64At(data, 64),
    delegate: u32At(data, 72) === 1 ? addrAt(data, 76) : null,
    state: state === 1 ? 'initialized' : 'frozen',
    delegatedAmount: u64At(data, 121),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class KitPortfolioReader implements PortfolioReader {
  private readonly fetchFn: FetchFn;
  private das: Promise<boolean> | undefined;

  constructor(
    private readonly rpcUrl: string,
    opts: { fetch?: FetchFn } = {},
  ) {
    this.fetchFn = opts.fetch ?? ((...args) => fetch(...args));
  }

  private call<T>(method: string, params: unknown): Promise<T> {
    return rpcCall<T>(this.fetchFn, this.rpcUrl, method, params);
  }

  async getBalance(owner: Address): Promise<bigint> {
    return toBig((await this.call<Ctx<number | bigint>>('getBalance', [owner, { commitment: 'confirmed' }])).value);
  }

  async getTokenAccounts(owner: Address): Promise<TokenAccountInfo[]> {
    const byProgram = await Promise.all(
      [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map(async (program) => {
        const res = await this.call<Ctx<{ pubkey: Address; account: NonNullable<UiAccount> }[]>>('getTokenAccountsByOwner', [
          owner,
          { programId: program },
          { encoding: 'base64', commitment: 'confirmed' },
        ]);
        return res.value.flatMap(({ pubkey, account }) => {
          const decoded = decodeTokenAccount(b64(account.data[0]));
          return decoded ? [{ ...decoded, address: pubkey, program }] : [];
        });
      }),
    );
    const accounts = byProgram.flat();
    const decimals = await this.mintDecimals([...new Set(accounts.map((a) => a.mint))]);
    return accounts.map((a) => ({ ...a, decimals: decimals.get(a.mint) ?? 0 }));
  }

  private async mintDecimals(mints: Address[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (let i = 0; i < mints.length; i += MAX_ACCOUNTS_PER_CALL) {
      const chunk = mints.slice(i, i + MAX_ACCOUNTS_PER_CALL);
      const res = await this.call<Ctx<UiAccount[]>>('getMultipleAccounts', [chunk, { encoding: 'base64', commitment: 'confirmed' }]);
      res.value.forEach((acc, j) => {
        const data = acc && b64(acc.data[0]);
        if (data && data.length > MINT_DECIMALS_OFFSET) out.set(chunk[j]!, data[MINT_DECIMALS_OFFSET]!);
      });
    }
    return out;
  }

  /** Network and rate-limit failures propagate and are not cached; any other refusal means no DAS. */
  hasDas(): Promise<boolean> {
    this.das ??= this.call('getAssetsByOwner', { ownerAddress: DAS_PROBE_OWNER, page: 1, limit: 1 }).then(
      () => true,
      (e: unknown) => {
        if (e instanceof UnsupportedMethodError) return false;
        if (e instanceof RpcError && e.code !== -429 && !(e.code <= -500 && e.code > -600)) return false;
        this.das = undefined;
        throw e;
      },
    );
    return this.das;
  }

  async getAssetsByOwner(owner: Address): Promise<DasAsset[]> {
    if (!(await this.hasDas())) throw new UnsupportedMethodError('getAssetsByOwner');
    const assets: DasAsset[] = [];
    for (let page = 1; page <= DAS_MAX_PAGES; page++) {
      const res = await this.call<{ items: DasItem[] }>('getAssetsByOwner', {
        ownerAddress: owner,
        page,
        limit: DAS_PAGE_LIMIT,
        options: { showFungible: true, showZeroBalance: false },
      });
      for (const item of res.items) if (FUNGIBLE.has(item.interface)) assets.push(toDasAsset(item));
      if (res.items.length < DAS_PAGE_LIMIT) break;
    }
    return assets;
  }

  async getSignatures(addr: Address, opts: { before?: string; limit: number }): Promise<SignatureInfo[]> {
    const res = await this.call<{ signature: string; slot: number | bigint; blockTime: number | null; err: unknown }[]>(
      'getSignaturesForAddress',
      [addr, { limit: opts.limit, commitment: 'confirmed', ...(opts.before && { before: opts.before }) }],
    );
    return res.map((s) => ({ signature: s.signature, slot: toBig(s.slot), blockTime: s.blockTime ?? null, err: s.err ?? null }));
  }

  async getHealth(): Promise<{ slot: bigint; latencyMs: number }> {
    const start = performance.now();
    const slot = await this.call<number | bigint>('getSlot', [{ commitment: 'confirmed' }]);
    return { slot: toBig(slot), latencyMs: Math.round(performance.now() - start) };
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    const { value } = await this.call<Ctx<{ blockhash: string; lastValidBlockHeight: number | bigint }>>('getLatestBlockhash', [
      { commitment: 'confirmed' },
    ]);
    return { blockhash: value.blockhash, lastValidBlockHeight: toBig(value.lastValidBlockHeight) };
  }

  async confirm(signature: string, lastValidBlockHeight: bigint, opts: { pollMs?: number } = {}): Promise<'confirmed' | 'failed' | 'expired'> {
    const pollMs = opts.pollMs ?? 1000;
    for (;;) {
      const status = await this.status(signature);
      if (status) return status;
      const height = toBig(await this.call<number | bigint>('getBlockHeight', [{ commitment: 'confirmed' }]));
      if (height > lastValidBlockHeight) return (await this.status(signature)) ?? 'expired';
      await sleep(pollMs);
    }
  }

  /** 'confirmed' at confirmed commitment or better, 'failed' when it landed with an error, else null (unknown or processed only). */
  async status(signature: string): Promise<'confirmed' | 'failed' | null> {
    const { value } = await this.call<Ctx<({ err: unknown; confirmationStatus: string | null } | null)[]>>('getSignatureStatuses', [
      [signature],
      { searchTransactionHistory: false },
    ]);
    const s = value[0];
    if (!s) return null;
    if (s.err !== null && s.err !== undefined) return 'failed';
    return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? 'confirmed' : null;
  }
}

type DasItem = {
  id: Address;
  interface: string;
  content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string }; files?: { uri?: string }[] };
  token_info?: {
    symbol?: string;
    decimals?: number;
    balance?: number | bigint;
    token_program?: Address;
    mint_authority?: string | null;
    freeze_authority?: string | null;
  };
};

function toDasAsset(item: DasItem): DasAsset {
  const meta = item.content?.metadata;
  const info = item.token_info;
  const image = item.content?.links?.image ?? item.content?.files?.[0]?.uri;
  const symbol = meta?.symbol || info?.symbol;
  return {
    id: item.id,
    interface: item.interface,
    ...(meta?.name && { name: meta.name }),
    ...(symbol && { symbol }),
    ...(image && { image }),
    ...(info?.decimals !== undefined && { decimals: info.decimals }),
    ...(info?.balance !== undefined && { balance: toBig(info.balance) }),
    ...(info?.token_program && { tokenProgram: info.token_program }),
    ...(info && 'mint_authority' in info && { mintAuthority: info.mint_authority ?? null }),
    ...(info && 'freeze_authority' in info && { freezeAuthority: info.freeze_authority ?? null }),
  };
}
