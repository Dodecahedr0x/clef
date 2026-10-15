import { MemorySender } from '@clef/rpc';
import { MemoryStore, Vault } from '@clef/vault';
import { address } from '@solana/kit';
import { AccountStore, PermissionStore, SettingsStore, WalletService, type ApprovalDecision, type ApprovalRequest } from '../src';

export const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const A = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
export const ORIGIN = 'https://dapp.example';
export const FAST = { memoryKiB: 1024, iterations: 1, parallelism: 1 };

export type Decide = (r: ApprovalRequest) => ApprovalDecision | Promise<ApprovalDecision>;

/** A wallet holding the "abandon" account A (HD index 0), with a scripted approver. */
export async function setup(decide: Decide = () => ({ approved: true })) {
  const local = new MemoryStore();
  const vault = new Vault(local, new MemoryStore(), FAST);
  const [secretId] = await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
  const accounts = new AccountStore(local);
  await accounts.add({ kind: 'hd', address: A, label: 'Account 1', secretId: secretId!, index: 0 });
  const permissions = new PermissionStore(local);
  const approvals: ApprovalRequest[] = [];
  const events: { origin: string; accounts: string[] }[] = [];
  let activity = 0;
  const sender = new MemorySender('5sigBase58');
  const service = new WalletService({
    vault,
    accounts,
    permissions,
    settings: new SettingsStore(local),
    sender,
    approver: {
      request: async (r) => {
        approvals.push(r);
        return decide(r);
      },
    },
    emit: (origin, accts) => events.push({ origin, accounts: accts }),
    activity: async () => {
      activity++;
    },
  });
  return { service, vault, accounts, permissions, approvals, events, sender, activityCount: () => activity };
}

/** Approves connect with account A, then defers to `decide` for everything else. */
export async function connected(decide: Decide = () => ({ approved: true })) {
  const ctx = await setup((r) => (r.kind === 'connect' ? { approved: true, accounts: [A] } : decide(r)));
  await ctx.service.handle(ORIGIN, { id: 'c', method: 'connect', params: {} });
  return ctx;
}
