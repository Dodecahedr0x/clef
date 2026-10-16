import type { TransactionSender } from '@clef/rpc';
import { NotASignerError, signMessageBytes, signTransactionWire } from '@clef/signers';
import { LockedError, toBase64, type Vault } from '@clef/vault';
import { getBase58Decoder, getBase58Encoder, getTransactionDecoder, type Address } from '@solana/kit';
import { createSignInMessage } from '@solana/wallet-standard-util';
import { isKeyAccount, keyRef, type Account, type AccountStore } from './accounts';
import { attachSignature, transactionMessageBytes, verifyEd25519 } from './hardware';
import type { PermissionStore } from './permissions';
import type { PhishingHit } from './phishing';
import { ERR, failure, parseRequest, ProtocolError, type Request, type Response, type SignInInput } from './protocol';
import type { RequestLogEntry } from './request-log';
import { chainFor, type SettingsStore } from './settings';

/** Origin of requests made by Clef's own popup (send, swap, proposals). Never phishing-checked, needs no connection. */
export const INTERNAL_ORIGIN = 'clef://wallet';

export type SignerInfo =
  | { kind: 'software' }
  | { kind: 'ledger'; address: Address; path: string }
  | { kind: 'keystone'; address: Address; path: string; xfp: string };

export type ApprovalRequest =
  | { kind: 'connect'; origin: string; phishing: PhishingHit | null }
  | { kind: 'signTransactions'; origin: string; phishing: PhishingHit | null; account: Address; chain: string; transactions: Uint8Array[]; send: boolean; signer: SignerInfo }
  | { kind: 'signMessage'; origin: string; phishing: PhishingHit | null; account: Address; message: Uint8Array; signer: SignerInfo }
  /** `signer` is null until an account is chosen; the page resolves it from state. */
  | { kind: 'signIn'; origin: string; phishing: PhishingHit | null; account: Address | null; input: SignInInput; signer: SignerInfo | null }
  | {
      kind: 'squadsPropose';
      origin: string;
      phishing: PhishingHit | null;
      account: Address;
      multisig: Address;
      vaultIndex: number;
      member: Address;
      inner: Uint8Array;
      /** Unsigned outer transactions, sent in order; more than one when the inner message goes through a transaction buffer. */
      proposals: Uint8Array[];
      signer: SignerInfo;
    };

/** What the approval page saw, for the local request log. */
export type DecisionLog = { summary?: string; dangerRules?: string[]; snapshot?: RequestLogEntry['snapshot'] };

/**
 * `accounts` answers a connect; `account` answers a sign-in that did not name one. `signatures` come from a hardware
 * signer (one per transaction, or one for a message / sign-in / proposal) and are verified before use.
 */
export type ApprovalDecision = ({ approved: false } | { approved: true; accounts?: string[]; account?: string; signatures?: Uint8Array[] }) & { log?: DecisionLog };

/** Shows a request to the user in an extension-owned window and resolves with their decision. */
export interface Approver {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

/** The slice of `@clef/squads` the service needs, bound to the active RPC by the background. */
export type SquadsClient = {
  fetchMultisig(multisig: Address): Promise<{ transactionIndex: bigint; members: { key: Address; initiate?: boolean }[] } | null>;
  buildProposeTransactions(p: { multisig: Address; vaultIndex: number; member: Address; innerWire: Uint8Array; transactionIndex: bigint; blockhash: string }): Promise<Uint8Array[]>;
  latestBlockhash(): Promise<string>;
  /** Waits for a sent transaction; required to send buffered proposals (each must land before the next). */
  confirm?(signature: string): Promise<'confirmed' | 'failed' | 'expired'>;
};

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
  phishing?: { check(hostname: string): Promise<PhishingHit | null> };
  log?: { add(e: Omit<RequestLogEntry, 'id' | 'at'>): Promise<unknown> };
  squads?: SquadsClient;
};

export type SubmitParams = { account: string; transactions: Uint8Array[]; send: boolean };
export type SubmitResult = { signatures: string[] } | { signedTransactions: string[] };

const MAX_PENDING_PER_ORIGIN = 3;
const REJECTED = () => new ProtocolError(ERR.USER_REJECTED, 'User rejected the request');
const BAD_HARDWARE_SIGNATURE = 'Hardware signature missing or invalid';
const b58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);

type Outcome<T> = { result: T; signatures?: string[] };
type SignTxResult = { signed: Uint8Array[]; sent: string[] | null };

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
    if (origin === INTERNAL_ORIGIN) return failure(req.id, new ProtocolError(ERR.UNAUTHORIZED, 'Reserved origin'));
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

  /** Signing for Clef's own screens: same approval window as a dApp, origin INTERNAL_ORIGIN. Throws on failure. */
  async submit(p: SubmitParams): Promise<SubmitResult> {
    try {
      await this.deps.activity();
      const account = await this.signer(INTERNAL_ORIGIN, p.account);
      const chain = await this.activeChain();
      if (account.kind === 'squads') {
        if (!p.send) throw unsupportedSquadsSign();
        if (p.transactions.length !== 1) throw new ProtocolError(ERR.UNSUPPORTED, 'Multisig proposals take one transaction');
        const signature = await this.propose(INTERNAL_ORIGIN, account, p.transactions[0]!, false);
        return { signatures: [signature] };
      }
      const { signed, sent } = await this.signTransactions(INTERNAL_ORIGIN, account, chain, p.transactions, p.send, false);
      return sent ? { signatures: sent } : { signedTransactions: signed.map(toBase64) };
    } catch (e) {
      const err = toProtocolError(e);
      throw err instanceof Error ? err : new Error('Internal error');
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
    return this.run({ kind: 'connect', origin, phishing: await this.phishing(origin) }, async (decision) => {
      const held = new Set<string>((await this.deps.accounts.list()).map((a) => a.address));
      const chosen = [...new Set(decision.accounts ?? [])];
      if (chosen.length === 0 || !chosen.every((a) => held.has(a))) throw new Error('Invalid account selection');
      await this.deps.permissions.grant(origin, chosen as Address[]);
      this.deps.emit(origin, chosen);
      return { result: { accounts: chosen } };
    });
  }

  private async sign(origin: string, req: Request): Promise<unknown> {
    switch (req.method) {
      case 'signTransaction': {
        const { account, chain, transactions } = req.params;
        const acct = await this.signer(origin, account);
        if (acct.kind === 'squads') throw unsupportedSquadsSign();
        await this.requireChain(chain);
        const { signed } = await this.signTransactions(origin, acct, chain, transactions, false, false);
        return { signedTransactions: signed.map(toBase64) };
      }
      case 'signAndSendTransaction': {
        const { account, chain, transaction, skipPreflight } = req.params;
        const acct = await this.signer(origin, account);
        await this.requireChain(chain);
        const signature =
          acct.kind === 'squads'
            ? await this.propose(origin, acct, transaction, skipPreflight)
            : (await this.signTransactions(origin, acct, chain, [transaction], true, skipPreflight)).sent![0]!;
        return { signature: toBase64(new Uint8Array(getBase58Encoder().encode(signature))) };
      }
      case 'signMessage': {
        const { account, message } = req.params;
        const acct = await this.signer(origin, account);
        if (acct.kind === 'squads') throw new ProtocolError(ERR.UNSUPPORTED, 'Multisig accounts cannot sign messages');
        const signer = signerInfo(acct);
        return this.run({ kind: 'signMessage', origin, phishing: await this.phishing(origin), account: acct.address, message, signer }, async (d) => {
          const signature = await this.signBytes(acct, message, d);
          return { result: { signedMessage: toBase64(message), signature: toBase64(signature) } };
        });
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
    const requestedAcct = requested ? await this.messageSigner(requested) : null;
    const bound = { ...input, domain: host };
    const req: ApprovalRequest = {
      kind: 'signIn',
      origin,
      phishing: await this.phishing(origin),
      account: requested,
      input: bound,
      signer: requestedAcct ? signerInfo(requestedAcct) : null,
    };
    return this.run(req, async (decision) => {
      const acct = requestedAcct ?? (decision.account ? await this.messageSigner(decision.account).catch(() => null) : null);
      if (!acct) throw new Error('Invalid account selection');
      const address = acct.address;
      const message = signInMessageBytes(bound, address);
      const signature = await this.signBytes(acct, message, decision);
      const accounts = [...new Set([...((await this.deps.permissions.get(origin))?.accounts ?? []), address])];
      await this.deps.permissions.grant(origin, accounts);
      this.deps.emit(origin, accounts);
      return { result: { account: address, signedMessage: toBase64(message), signature: toBase64(signature) } };
    });
  }

  private async signTransactions(origin: string, acct: Account, chain: string, wires: Uint8Array[], send: boolean, skipPreflight: boolean): Promise<SignTxResult> {
    wires.forEach((t) => requireSigner(t, acct.address));
    const req: ApprovalRequest = {
      kind: 'signTransactions',
      origin,
      phishing: await this.phishing(origin),
      account: acct.address,
      chain,
      transactions: wires,
      send,
      signer: signerInfo(acct),
    };
    return this.run<SignTxResult>(req, async (d) => {
      const signed = await this.signWires(acct, wires, d);
      const ids = signed.map(firstSignature).filter(Boolean);
      if (!send) return { result: { signed, sent: null }, signatures: ids };
      const sent: string[] = [];
      for (const wire of signed) sent.push(await this.deps.sender.send(wire, { skipPreflight }));
      return { result: { signed, sent }, signatures: sent };
    });
  }

  /** Squads: the dApp's transaction becomes a vault transaction + proposal signed by the member. Returns the last outer tx signature. */
  private async propose(origin: string, vault: Extract<Account, { kind: 'squads' }>, inner: Uint8Array, skipPreflight: boolean): Promise<string> {
    requireSigner(inner, vault.address);
    const squads = this.deps.squads;
    if (!squads) throw new ProtocolError(ERR.UNSUPPORTED, 'Multisig is not available');
    const member = await this.deps.accounts.get(vault.member);
    if (!member || !isKeyAccount(member)) throw new ProtocolError(ERR.UNAUTHORIZED, 'Account cannot sign');
    const info = await squads.fetchMultisig(vault.multisig);
    if (!info) throw new Error('Multisig not found');
    if (!info.members.some((m) => m.key === member.address && m.initiate !== false)) throw new ProtocolError(ERR.UNAUTHORIZED, 'Member cannot propose');
    const proposals = await squads.buildProposeTransactions({
      multisig: vault.multisig,
      vaultIndex: vault.vaultIndex,
      member: member.address,
      innerWire: inner,
      transactionIndex: info.transactionIndex + 1n,
      blockhash: await squads.latestBlockhash(),
    });
    const req: ApprovalRequest = {
      kind: 'squadsPropose',
      origin,
      phishing: await this.phishing(origin),
      account: vault.address,
      multisig: vault.multisig,
      vaultIndex: vault.vaultIndex,
      member: member.address,
      inner,
      proposals,
      signer: signerInfo(member),
    };
    if (proposals.length > 1 && !squads.confirm) throw new ProtocolError(ERR.UNSUPPORTED, 'Multisig transaction too large');
    return this.run(req, async (d) => {
      const signed = await this.signWires(member, proposals, d);
      const sent: string[] = [];
      for (const [i, wire] of signed.entries()) {
        const signature = await this.deps.sender.send(wire, { skipPreflight });
        sent.push(signature);
        if (i < signed.length - 1) {
          const status = await squads.confirm!(signature);
          if (status !== 'confirmed') throw new Error(`Proposal transaction ${i + 1} of ${signed.length} ${status}`);
        }
      }
      return { result: sent.at(-1)!, signatures: sent };
    });
  }

  /** Prompts, then runs `after` on approval; every outcome is written to the request log. */
  private async run<T>(req: ApprovalRequest, after: (d: ApprovalDecision & { approved: true }) => Promise<Outcome<T>>): Promise<T> {
    const decision = await this.deps.approver.request(req);
    if (!decision.approved) {
      await this.record(req, decision, req.phishing ? 'blocked' : 'rejected');
      throw REJECTED();
    }
    let outcome: Outcome<T>;
    try {
      outcome = await after(decision);
    } catch (e) {
      await this.record(req, decision, 'failed');
      throw e;
    }
    await this.record(req, decision, 'approved', outcome.signatures);
    return outcome.result;
  }

  private async record(req: ApprovalRequest, d: ApprovalDecision, outcome: RequestLogEntry['outcome'], signatures?: string[]): Promise<void> {
    const log = this.deps.log;
    if (!log) return;
    const account = req.kind === 'connect' ? undefined : (req.account ?? (d.approved && d.account ? (d.account as Address) : undefined));
    const summary = typeof d.log?.summary === 'string' && d.log.summary ? d.log.summary : defaultSummary(req);
    const dangerRules = Array.isArray(d.log?.dangerRules) ? d.log.dangerRules.filter((r) => typeof r === 'string').slice(0, 20) : [];
    try {
      await log.add({
        origin: req.origin,
        kind: req.kind,
        outcome,
        ...(account && { account }),
        summary,
        dangerRules,
        ...(signatures && { signatures }),
        ...(d.log?.snapshot && { snapshot: d.log.snapshot }),
      });
    } catch {
      // the log is best effort; it never changes a request's outcome
    }
  }

  private async signWires(acct: Account, wires: Uint8Array[], d: ApprovalDecision & { approved: true }): Promise<Uint8Array[]> {
    if (acct.kind === 'ledger' || acct.kind === 'keystone') {
      const sigs = d.signatures;
      if (!sigs || sigs.length !== wires.length) throw new Error(BAD_HARDWARE_SIGNATURE);
      const out: Uint8Array[] = [];
      for (const [i, wire] of wires.entries()) {
        if (!(await verifyEd25519(transactionMessageBytes(wire), sigs[i]!, acct.address))) throw new Error(BAD_HARDWARE_SIGNATURE);
        out.push(attachSignature(wire, acct.address, sigs[i]!));
      }
      return out;
    }
    return this.withKey(acct, (key) => Promise.all(wires.map((t) => signTransactionWire(t, acct.address, key))));
  }

  private async signBytes(acct: Account, message: Uint8Array, d: ApprovalDecision & { approved: true }): Promise<Uint8Array> {
    if (acct.kind === 'ledger' || acct.kind === 'keystone') {
      const sig = d.signatures?.length === 1 ? d.signatures[0]! : null;
      if (!sig || !(await verifyEd25519(message, sig, acct.address))) throw new Error(BAD_HARDWARE_SIGNATURE);
      return new Uint8Array(sig);
    }
    return new Uint8Array(await this.withKey(acct, (key) => signMessageBytes(message, acct.address, key)));
  }

  /** A connected (or internal) account that can sign. */
  private async signer(origin: string, account: string): Promise<Account> {
    if (origin !== INTERNAL_ORIGIN && !(await this.deps.permissions.allowed(origin, account))) throw new ProtocolError(ERR.UNAUTHORIZED, 'Account not connected');
    if (!(await this.deps.accounts.canSign(account))) throw new ProtocolError(ERR.UNAUTHORIZED, 'Account cannot sign');
    return (await this.deps.accounts.get(account))!;
  }

  private async messageSigner(address: string): Promise<Account> {
    const acct = await this.deps.accounts.get(address);
    if (!acct || !isKeyAccount(acct)) throw new ProtocolError(ERR.UNAUTHORIZED, 'Account cannot sign');
    return acct;
  }

  private async phishing(origin: string): Promise<PhishingHit | null> {
    if (origin === INTERNAL_ORIGIN || !this.deps.phishing) return null;
    try {
      return await this.deps.phishing.check(new URL(origin).hostname);
    } catch {
      return null;
    }
  }

  private async requireChain(chain: string): Promise<void> {
    if (chain !== (await this.activeChain())) throw new ProtocolError(ERR.UNSUPPORTED, 'Wrong network');
  }

  /** Runs `fn` with the account's private key; the vault zeroes it afterwards. */
  private async withKey<T>(account: Account, fn: (key: Uint8Array) => Promise<T>): Promise<T> {
    if (account.kind !== 'hd' && account.kind !== 'imported') throw new ProtocolError(ERR.UNAUTHORIZED, 'Account cannot sign');
    return this.deps.vault.withPrivateKey(keyRef(account), async (key, derived) => {
      if (derived !== account.address) throw new Error('Key does not match the account');
      return fn(key);
    });
  }

  private async activeChain(): Promise<string> {
    return chainFor(await this.deps.settings.get());
  }
}

/** The exact bytes signed for Sign-In With Solana. */
export function signInMessageBytes(input: SignInInput, address: Address): Uint8Array {
  const { domain } = input;
  if (!domain) throw new Error('Sign-in domain required');
  return createSignInMessage({ ...input, domain, address });
}

function signerInfo(a: Account): SignerInfo {
  if (a.kind === 'ledger') return { kind: 'ledger', address: a.address, path: a.path };
  if (a.kind === 'keystone') return { kind: 'keystone', address: a.address, path: a.path, xfp: a.xfp };
  return { kind: 'software' };
}

const unsupportedSquadsSign = () => new ProtocolError(ERR.UNSUPPORTED, 'Multisig accounts can only sign and send');

function defaultSummary(req: ApprovalRequest): string {
  switch (req.kind) {
    case 'connect':
      return 'Connect';
    case 'signTransactions':
      return req.send ? 'Sign and send transaction' : req.transactions.length > 1 ? `Sign ${req.transactions.length} transactions` : 'Sign transaction';
    case 'signMessage':
      return 'Sign message';
    case 'signIn':
      return 'Sign in';
    case 'squadsPropose':
      return 'Propose multisig transaction';
  }
}

/** The transaction id: the fee payer's (first) signature. */
function firstSignature(wire: Uint8Array): string {
  const first = Object.values(getTransactionDecoder().decode(wire).signatures)[0];
  return first ? b58(first) : '';
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
