import { readFileSync } from 'node:fs';
import { resolveIdl } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { address, getAddressEncoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountCache } from '../src/accounts';
import { dataRelations } from '../src/data-relations';

const PROGRAM = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const STATE = address('6ur7v6AXNpnHeEb6xuk7PyezvZ1i5GrgYyWZkNCpzbRz');
const VAULT = address('FKcEb4TdPDTRuMnQDpSEPQBcrm15S73xiUD6Qf8ZLUkq');
const MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WALLET = address('5Hs51hUxpr9cBz8gwbsFNVcJqdtPeJR8MoUNxoUSGP8a');
const SYSTEM = address('11111111111111111111111111111111');
const key = (a: Address) => new Uint8Array(getAddressEncoder().encode(a));

async function cacheWith(accounts: { address: Address; owner: Address; data: Uint8Array; executable?: boolean }[]) {
  const reader = new MemoryChainReader();
  for (const a of accounts) reader.setAccount({ address: a.address, owner: a.owner, lamports: 1n, data: a.data, executable: a.executable ?? false });
  const cache = new AccountCache(reader);
  await cache.load(accounts.map((a) => a.address));
  return cache;
}

describe('dataRelations', () => {
  it('links accounts to their owner program in the transaction and to the keys their data holds; zero bytes never count as the System Program', async () => {
    // 8-byte header, then the vault and mint keys, then 32 zero bytes (an unset field).
    const data = new Uint8Array([...new Uint8Array(8).fill(1), ...key(VAULT), ...key(MINT), ...new Uint8Array(32)]);
    const cache = await cacheWith([
      { address: STATE, owner: PROGRAM, data },
      { address: PROGRAM, owner: address('BPFLoaderUpgradeab1e11111111111111111111111'), data: new Uint8Array(), executable: true },
      { address: WALLET, owner: SYSTEM, data: new Uint8Array() },
    ]);
    const edges = dataRelations([STATE, VAULT, MINT, PROGRAM, WALLET, SYSTEM], cache, () => undefined);
    expect(edges).toEqual([
      { kind: 'program-owner', from: STATE, to: PROGRAM, label: 'owned by', status: 'verified', external: false },
      expect.objectContaining({ kind: 'data-ref', from: STATE, to: VAULT, label: 'stores' }),
      expect.objectContaining({ kind: 'data-ref', from: STATE, to: MINT, label: 'stores' }),
      // System and Token ownership are drawn too when that program is in the transaction.
      { kind: 'program-owner', from: WALLET, to: SYSTEM, label: 'owned by', status: 'verified', external: false },
    ]);
  });

  it('names the field when the program IDL decodes the account', async () => {
    const vaultIdl = JSON.parse(readFileSync(new URL('./fixtures/vault-anchor.json', import.meta.url), 'utf8'));
    const idl = await resolveIdl(PROGRAM, 'user', 'user', vaultIdl);
    const pool = idl.root.program.accounts?.find((a) => a.name === 'pool');
    expect(pool).toBeTruthy();
    // vault-anchor's Pool: discriminator, then its pubkey fields in order.
    const disc = Uint8Array.from(vaultIdl.accounts[0].discriminator as number[]);
    const fields = (vaultIdl.types[0].type.fields as { name: string; type: string }[]).filter((f) => f.type === 'pubkey');
    const values = fields.map((_, i) => [VAULT, MINT, WALLET][i]!);
    const data = new Uint8Array([...disc, ...values.flatMap((v) => [...key(v)]), 254]); // + bump (u8)
    const cache = await cacheWith([{ address: STATE, owner: PROGRAM, data }]);
    const edges = dataRelations([STATE, ...values], cache, () => idl).filter((e) => e.kind === 'data-ref');
    expect(edges.map((e) => e.label)).toEqual(fields.map((f) => f.name));
  });
});
