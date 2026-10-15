import type { TransactionSender } from '@clef/rpc';
import { NotASignerError, signMessageBytes, signTransactionWire } from '@clef/signers';
import { LockedError, toBase64, type Vault } from '@clef/vault';
import { getBase58Encoder, getTransactionDecoder, type Address } from '@solana/kit';
import { createSignInMessage } from '@solana/wallet-standard-util';
import type { AccountStore } from './accounts';
import type { PermissionStore } from './permissions';
import { ERR, failure, parseRequest, ProtocolError, type Request, type Response, type SignInInput } from './protocol';
import { chainFor, type SettingsStore } from './settings';

export type ApprovalRequest =
  | { kind: 'connect'; origin: string }
  | { kind: 'signTransactions'; origin: string; account: Address; chain: string; transactions: Uint8Array[]; send: boolean }
  | { kind: 'signMessage'; origin: string; account: Address; message: Uint8Array }
  | { kind: 'signIn'; origin: string; account: Address | null; input: SignInInput };

/** `accounts` answers a connect; `account` answers a sign-in that did not name one. */
export type ApprovalDecision = { approved: false } | { approved: true; accounts?: string[]; account?: string };

/** Shows a request to the user in an extension-owned window and resolves with their decision. */
export interface Approver {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

export type WalletServiceDeps = {
  vault: Vault;
  accounts: AccountStore;
  permissions: PermissionStore;
  settings: SettingsStore;
  sender: TransactionSender;
  approver: Approver;
  /** Pushes an accounts-changed event to every page of `origin`. */
  emit: (origin: string, accounts: string[]) => void;
  /** Called for every valid request: re-arms auto-lock. */
  activity: () => Promise<void>;
};

const MAX_PENDING_PER_ORIGIN = 3;

/**
 * Handles dApp requests. `origin` must come from the browser (the port's sender), never from the request.
 * Never throws: every outcome is a `Response`.
 */
export class WalletService {
  private readonly pending = new Map<string, number>();

  constructor(private readonly deps: WalletServiceDeps) {}

  async handle(origin: string, raw: unknown): Promise<Response> {
    const rawId = (raw as { id?: unknown } | null)?.id;
    const id = typeof rawId === 'string' ? rawId.slice(0, 64) : '';
    let req: Request;
    try {
      req = parseRequest(raw);
    } catch (e) {
      return failure(id, e);
    }
    const count = this.pending.get(origin) ?? 0;
    if (count >= MAX_PENDING_PER_ORIGIN) return failure(req.id, new ProtocolError(ERR.BUSY, 'Too many pending requests'));
    this.pending.set(origin, count + 1);
    try {
      await this.deps.activity();
      return { id: req.id, ok: true, result: await this.dispatch(origin, req) };
    } catch (e) {
      return failure(req.id, toProtocolError(e));
    } finally {
      const left = (this.pending.get(origin) ?? 1) - 1;
      if (left > 0) this.pending.set(origin, left);
      else this.pending.delete(origin);
    }
  }

  private async dispatch(origin: string, req: Request): Promise<unknown> {
    switch (req.method) {
      case 'connect':
        return this.connect(origin, req.params.silent);
      case 'disconnect':
        await this.deps.permissions.revoke(origin);
        this.deps.emit(origin, []);
        return {};
      default:
        return this.sign(origin, req);
    }
  }

  private async connect(origin: string, silent: boolean): Promise<{ accounts: string[] }> {
    const existing = await this.deps.permissions.get(origin);
    if (existing) return { accounts: existing.accounts };
    if (silent) return { accounts: [] };
    const decision = await this.deps.approver.request({ kind: 'connect', origin });
    if (!decision.approved) throw new ProtocolError(ERR.USER_REJECTED, 'User rejected the request');
    const held = new Set<string>((await this.deps.accounts.list()).map((a) => a.address));
    const chosen = [...new Set(decision.accounts ?? [])];
    if (chosen.length === 0 || !chosen.every((a) => held.has(a))) throw new Error('Invalid account selection');
    await this.deps.permissions.grant(origin, chosen as Address[]);
    this.deps.emit(origin, chosen);
    return { accounts: chosen };
  }

  private async sign(origin: string, req: Request): Promise<unknown> {
    switch (req.method) {
      case 'signTransaction': {
        const { account, chain, transactions } = req.params;
        const address = await this.signableAccount(origin, account);
        await this.requireChain(chain);
        transactions.forEach((t) => requireSigner(t, address));
        await this.approve({ kind: 'signTransactions', origin, account: address, chain, transactions, send: false });
        const signed = await this.withKey(address, (key) => Promise.all(transactions.map((t) => signTransactionWire(t, address, key))));
        return { signedTransactions: signed.map(toBase64) };
      }
      case 'signAndSendTransaction': {
        const { account, chain, transaction, skipPreflight } = req.params;
        const address = await this.signableAccount(origin, account);
        await this.requireChain(chain);
        requireSigner(transaction, address);
        await this.approve({ kind: 'signTransactions', origin, account: address, chain, transactions: [transaction], send: true });
        const signed = await this.withKey(address, (key) => signTransactionWire(transaction, address, key));
        const signature = await this.deps.sender.send(signed, { skipPreflight });
        return { signature: toBase64(new Uint8Array(getBase58Encoder().encode(signature))) };
      }
      case 'signMessage': {
        const { account, message } = req.params;
        const address = await this.signableAccount(origin, account);
        await this.approve({ kind: 'signMessage', origin, account: address, message });
        const signature = await this.withKey(address, (key) => signMessageBytes(message, address, key));
        return { signedMessage: toBase64(message), signature: toBase64(new Uint8Array(signature)) };
      }
      case 'signIn':
        return this.signIn(origin, req.params.input);
      default:
        throw new ProtocolError(ERR.UNSUPPORTED, 'Unsupported method');
    }
  }

  /** Sign-In With Solana: the domain is always the requesting site's host, so a page cannot request a sign-in for another site. */
  private async signIn(origin: string, input: SignInInput): Promise<unknown> {
    const host = new URL(origin).host;
    if (input.domain !== undefined && input.domain !== host) throw new ProtocolError(ERR.INVALID_PARAMS, 'Sign-in domain does not match the requesting site');
    const requested = (input.address as Address | undefined) ?? null;
    if (requested && !(await this.deps.accounts.canSign(requested))) throw new ProtocolError(ERR.UNAUTHORIZED, 'Account cannot sign');
    const bound = { ...input, domain: host };
    const decision = await this.approve({ kind: 'signIn', origin, account: requested, input: bound });
    const address = (requested ?? decision.account) as Address | undefined;
    if (!address || !(await this.deps.accounts.canSign(address))) throw new Error('Invalid account selection');
    const message = createSignInMessage({ ...bound, address });
    const signature = await this.withKey(address, (key) => signMessageBytes(message, address, key));
    const accounts = [...new Set([...((await this.deps.permissions.get(origin))?.accounts ?? []), address])];
    await this.deps.permissions.grant(origin, accounts);
    this.deps.emit(origin, accounts);
    return { account: address, signedMessage: toBase64(message), signature: toBase64(new Uint8Array(signature)) };
  }

  private async signableAccount(origin: string, account: string): Promise<Address> {
    if (!(await this.deps.permissions.allowed(origin, account))) throw new ProtocolError(ERR.UNAUTHORIZED, 'Account not connected');
    if (!(await this.deps.accounts.canSign(account))) throw new ProtocolError(ERR.UNAUTHORIZED, 'Account cannot sign');
    return account as Address;
  }

  private async requireChain(chain: string): Promise<void> {
    if (chain !== (await this.activeChain())) throw new ProtocolError(ERR.UNSUPPORTED, 'Wrong network');
  }

  private async approve(req: ApprovalRequest): Promise<ApprovalDecision & { approved: true }> {
    const decision = await this.deps.approver.request(req);
    if (!decision.approved) throw new ProtocolError(ERR.USER_REJECTED, 'User rejected the request');
    return decision;
  }

  /** Runs `fn` with the account's private key; the vault zeroes it afterwards. */
  private async withKey<T>(address: Address, fn: (key: Uint8Array) => Promise<T>): Promise<T> {
    const account = await this.deps.accounts.get(address);
    if (!account || account.kind === 'watch') throw new ProtocolError(ERR.UNAUTHORIZED, 'Account cannot sign');
    const ref = account.kind === 'hd' ? { secretId: account.secretId, index: account.index } : { secretId: account.secretId };
    return this.deps.vault.withPrivateKey(ref, async (key, derived) => {
      if (derived !== address) throw new Error('Key does not match the account');
      return fn(key);
    });
  }

  private async activeChain(): Promise<string> {
    return chainFor((await this.deps.settings.get()).network);
  }
}

/** Refuses up front (before prompting) transactions the account is not a required signer of, or that do not decode. */
function requireSigner(wire: Uint8Array, account: Address): void {
  let signatures: Record<string, unknown>;
  try {
    signatures = getTransactionDecoder().decode(wire).signatures;
  } catch {
    throw new ProtocolError(ERR.INVALID_PARAMS, 'Transaction does not decode');
  }
  if (!Object.hasOwn(signatures, account)) throw new ProtocolError(ERR.INVALID_PARAMS, 'Account is not a signer of this transaction');
}

function toProtocolError(e: unknown): unknown {
  if (e instanceof LockedError) return new ProtocolError(ERR.UNAUTHORIZED, 'Wallet is locked');
  if (e instanceof NotASignerError) return new ProtocolError(ERR.INVALID_PARAMS, 'Account is not a signer of this transaction');
  return e;
}
