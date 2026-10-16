import { MemoryStore, Vault, validateMnemonic, WrongPasswordError } from '@clef/vault';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import {
  AccountStore,
  ContactStore,
  ErrorReporter,
  InternalApi,
  PermissionStore,
  RequestLog,
  SettingsStore,
  UserIdlStore,
  type FullWalletState,
  type SubmitParams,
} from '../src';
import { A, ABANDON, FAST } from './fixture';

const L = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const MULTISIG = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const SQUADS = address('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
const SYSTEM_IDL = JSON.stringify({ kind: 'rootNode', standard: 'codama', version: '1.0.0', program: { kind: 'programNode', name: 'demo', publicKey: L, version: '0.0.1', accounts: [], instructions: [], definedTypes: [], pdas: [], errors: [] }, additionalPrograms: [] });

function api(o: { endpoint?: string | null } = {}) {
  const local = new MemoryStore();
  const vault = new Vault(local, new MemoryStore(), FAST);
  const settings = new SettingsStore(local);
  const log = new RequestLog(local);
  const fetch = vi.fn(async () => new Response('{}'));
  const reporter = new ErrorReporter({ endpoint: o.endpoint ?? null, enabled: async () => (await settings.get()).errorReports, version: '1.0.0', browser: 'chrome', fetch });
  const submit = vi.fn(async (p: SubmitParams) => ({ signatures: p.transactions.map(() => 'sig') }));
  const phishing = { status: vi.fn(async () => ({ version: 2, fetchedAt: 5, domains: 9 })), refresh: vi.fn(async () => {}) };
  const internal = new InternalApi({
    vault,
    accounts: new AccountStore(local),
    permissions: new PermissionStore(local),
    settings,
    onLock: () => {},
    onUnlock: async () => {},
    emit: () => {},
    contacts: new ContactStore(local),
    userIdls: new UserIdlStore(local),
    log,
    phishing,
    reporter,
    service: { submit },
  });
  const call = (type: string, params: Record<string, unknown> = {}) => internal.call({ type, ...params });
  return { internal, call, vault, log, fetch, submit, phishing, state: () => call('state') as Promise<FullWalletState> };
}

async function onboarded(o?: Parameters<typeof api>[0]) {
  const ctx = api(o);
  await ctx.call('vault:create', { password: 'a long password', mnemonic: ABANDON });
  return ctx;
}

describe('InternalApi v2', () => {
  it('state includes the active account and error report availability', async () => {
    const { state, call } = await onboarded();
    expect(await state()).toMatchObject({ activeAccount: A, errorReportsAvailable: false });
    await call('accounts:watch', { address: L, label: 'Cold' });
    await call('accounts:select', { address: L });
    expect((await state()).activeAccount).toBe(L);
    await expect(call('accounts:select', { address: MULTISIG })).rejects.toThrow();
    await expect((await onboarded({ endpoint: 'https://errors.example/report' })).state()).resolves.toMatchObject({ errorReportsAvailable: true });
  });

  it('creates a vault with chosen indexes; scans; generates mnemonics', async () => {
    const { call, state } = api();
    const { accounts } = (await call('accounts:scan', { mnemonic: ABANDON, from: 0, count: 3 })) as { accounts: { index: number; address: string }[] };
    expect(accounts.map((a) => a.index)).toEqual([0, 1, 2]);
    expect(accounts[0]!.address).toBe(A);
    await expect(call('accounts:scan', { mnemonic: 'not a phrase', count: 3 })).rejects.toThrow(/recovery phrase/);
    await expect(call('accounts:scan', { mnemonic: ABANDON, count: 500 })).rejects.toThrow();
    await call('vault:create', { password: 'a long password', mnemonic: ABANDON, indexes: [0, 2] });
    expect((await state()).accounts.map((a) => [a.index, a.address])).toEqual([
      [0, A],
      [2, accounts[2]!.address],
    ]);
    const { mnemonic } = (await call('mnemonic:generate')) as { mnemonic: string };
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(validateMnemonic(mnemonic)).toBe(true);
  });

  it('reveals the mnemonic only with the password; changes the password', async () => {
    const { call } = await onboarded();
    await expect(call('vault:revealMnemonic', { password: 'wrong password!' })).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await call('vault:revealMnemonic', { password: 'a long password' })).toEqual({ mnemonic: ABANDON });
    await call('vault:changePassword', { current: 'a long password', next: 'another long password' });
    await call('vault:lock');
    await call('vault:unlock', { password: 'another long password' });
  });

  it('adds hardware and squads accounts; public fields only', async () => {
    const { call, state } = await onboarded();
    await call('accounts:addHardware', { kind: 'ledger', address: L, path: "44'/501'/0'/0'" });
    await expect(call('accounts:addHardware', { kind: 'trezor', address: MULTISIG, path: 'x' })).rejects.toThrow();
    await call('accounts:addSquads', { multisig: MULTISIG, vaultIndex: 0, member: L, label: 'Team' });
    await expect(call('accounts:addSquads', { multisig: MULTISIG, vaultIndex: 1, member: MULTISIG, label: 'x' })).rejects.toThrow(/member/);
    const [vault] = await getProgramDerivedAddress({ programAddress: SQUADS, seeds: ['multisig', getAddressEncoder().encode(MULTISIG), 'vault', new Uint8Array([0])] });
    const accounts = (await state()).accounts;
    expect(accounts[1]).toEqual({ kind: 'ledger', address: L, label: 'Ledger 1', path: "44'/501'/0'/0'" });
    expect(accounts[2]).toEqual({ kind: 'squads', address: vault, label: 'Team', multisig: MULTISIG, vaultIndex: 0, member: L });
  });

  it('settings:update accepts every v2 key and nothing else', async () => {
    const { call, state } = await onboarded();
    await call('settings:update', { patch: { detailLevel: 'expert', jupiterApiKey: 'k1', errorReports: true, network: 'localnet' } });
    expect((await state()).settings).toMatchObject({ detailLevel: 'expert', jupiterApiKey: 'k1', errorReports: true, network: 'localnet' });
    await expect(call('settings:update', { patch: { evil: 1 } })).rejects.toThrow();
  });

  it('contacts, user IDLs, request log', async () => {
    const { call, log } = await onboarded();
    await call('contacts:upsert', { address: L, name: 'Alice', kind: 'contact' });
    expect(await call('contacts:list')).toMatchObject([{ address: L, name: 'Alice' }]);
    await call('contacts:remove', { address: L });
    expect(await call('contacts:list')).toEqual([]);
    await expect(call('idls:add', { programId: L, network: 'mainnet', json: '{nope' })).rejects.toThrow(/Invalid IDL/);
    expect(await call('idls:add', { programId: L, network: 'mainnet', json: SYSTEM_IDL })).toMatchObject({ programId: L, name: 'demo' });
    expect(await call('idls:list')).toHaveLength(1);
    await call('idls:remove', { programId: L, network: 'mainnet' });
    expect(await call('idls:list')).toEqual([]);
    for (let i = 0; i < 3; i++) await log.add({ origin: 'https://d.example', kind: 'connect', outcome: 'rejected', summary: `n${i}`, dangerRules: [] });
    expect(((await call('log:list', { limit: 2 })) as { summary: string }[]).map((e) => e.summary)).toEqual(['n2', 'n1']);
    await call('log:clear');
    expect(await call('log:list')).toEqual([]);
  });

  it('phishing status/refresh and error reports', async () => {
    const { call, phishing, fetch } = await onboarded({ endpoint: 'https://errors.example/report' });
    expect(await call('phishing:status')).toEqual({ version: 2, fetchedAt: 5, domains: 9 });
    await call('phishing:refresh');
    expect(phishing.refresh).toHaveBeenCalledOnce();
    await call('errors:report', { area: 'popup', message: 'boom' });
    expect(fetch).not.toHaveBeenCalled();
    await call('settings:update', { patch: { errorReports: true } });
    await call('errors:report', { area: 'popup', message: 'boom', origin: 'https://d.example' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('wallet:submit decodes base64 wires and forwards to the service', async () => {
    const { call, submit } = await onboarded();
    expect(await call('wallet:submit', { account: A, transactions: ['AQID'], send: true, purpose: 'send' })).toEqual({ signatures: ['sig'] });
    expect(submit).toHaveBeenCalledWith({ account: A, transactions: [new Uint8Array([1, 2, 3])], send: true });
    await expect(call('wallet:submit', { account: A, transactions: [], send: true, purpose: 'send' })).rejects.toThrow();
    await expect(call('wallet:submit', { account: A, transactions: ['AQID'], send: true, purpose: 'steal' })).rejects.toThrow();
    await expect(call('wallet:submit', { account: A, transactions: ['%%%'], send: false, purpose: 'swap' })).rejects.toThrow();
  });
});
