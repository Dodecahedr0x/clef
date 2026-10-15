import type { TransactionSender } from '@clef/rpc';
import type { Vault } from '@clef/vault';
import type { Address } from '@solana/kit';
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
      return failure(req.id, e);
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

  // Signing flows: Task 14.
  private async sign(_origin: string, _req: Request): Promise<unknown> {
    throw new ProtocolError(ERR.UNSUPPORTED, 'Unsupported method');
  }

  private async activeChain(): Promise<string> {
    return chainFor((await this.deps.settings.get()).network);
  }
}
