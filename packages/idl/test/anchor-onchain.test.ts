import { MemoryChainReader } from '@clef/rpc';
import { address, type Address } from '@solana/kit';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { anchorIdlAddress, AnchorOnchainIdlSource, IdlDecodeError } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const JUP6 = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
// Verified against mainnet on 2026-10-15: the account exists and is owned by JUP6.
const JUP6_IDL_ACCOUNT = 'C88XWfp26heEmDkmfSzeXP7Fd7GQJ2j9dDTUsyiZbUTa';

function idlAccountBytes(compressed: Uint8Array, declaredLength = compressed.length): Uint8Array {
  const data = new Uint8Array(44 + compressed.length);
  new DataView(data.buffer).setUint32(40, declaredLength, true);
  data.set(compressed, 44);
  return data;
}

function idlAccountData(json: string): Uint8Array {
  return idlAccountBytes(zlibSync(new TextEncoder().encode(json)));
}

async function loadWith(data: Uint8Array, owner: Address = VAULT) {
  const reader = new MemoryChainReader();
  reader.setAccount({ address: await anchorIdlAddress(VAULT), owner, data });
  return new AnchorOnchainIdlSource(reader).load(VAULT);
}

describe('anchorIdlAddress', () => {
  it('matches the mainnet IDL account of Jupiter v6', async () => {
    expect(await anchorIdlAddress(JUP6)).toBe(JUP6_IDL_ACCOUNT);
  });
});

describe('AnchorOnchainIdlSource', () => {
  it('loads and inflates the IDL account', async () => {
    const idl = await loadWith(idlAccountData(JSON.stringify(vault)));
    expect(idl).toMatchObject({ source: 'anchor-onchain', trust: 'authority', programId: VAULT });
    expect(idl?.anchorExtras?.deposit).toBeDefined();
  });

  it('returns null when the program has no IDL account', async () => {
    expect(await new AnchorOnchainIdlSource(new MemoryChainReader()).load(VAULT)).toBeNull();
  });

  it('returns null when the IDL account is not owned by the program', async () => {
    expect(await loadWith(idlAccountData(JSON.stringify(vault)), JUP6)).toBeNull();
  });

  it('rejects accounts shorter than the header', async () => {
    await expect(loadWith(new Uint8Array(43))).rejects.toBeInstanceOf(IdlDecodeError);
  });

  it('rejects a declared length past the end of the account', async () => {
    const compressed = zlibSync(new TextEncoder().encode(JSON.stringify(vault)));
    await expect(loadWith(idlAccountBytes(compressed, compressed.length + 1))).rejects.toBeInstanceOf(IdlDecodeError);
  });

  it('rejects IDLs that inflate past 4 MiB', async () => {
    const bomb = zlibSync(new Uint8Array(5 * 1024 * 1024));
    await expect(loadWith(idlAccountBytes(bomb))).rejects.toThrow(new IdlDecodeError('IDL exceeds 4 MiB'));
  });

  it('rejects corrupt zlib data', async () => {
    await expect(loadWith(idlAccountBytes(new Uint8Array([1, 2, 3, 4, 5])))).rejects.toBeInstanceOf(IdlDecodeError);
  });

  it('rejects valid zlib data that is not JSON', async () => {
    await expect(loadWith(idlAccountData('not json'))).rejects.toBeInstanceOf(IdlDecodeError);
  });

  it('rejects an IDL declaring a different program address', async () => {
    await expect(loadWith(idlAccountData(JSON.stringify({ ...vault, address: JUP6 })))).rejects.toBeInstanceOf(
      IdlDecodeError,
    );
  });

  it('binds a legacy IDL without an address to the program id', async () => {
    const legacy = {
      version: '0.1.0',
      name: 'legacy_vault',
      instructions: [{ name: 'ping', accounts: [], args: [] }],
    };
    const idl = await loadWith(idlAccountData(JSON.stringify(legacy)));
    expect(idl?.root.program.publicKey).toBe(VAULT);
    expect(idl?.root.program.name).toBe('legacyVault');
  });
});
