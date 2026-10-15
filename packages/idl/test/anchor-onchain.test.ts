import { MemoryChainReader } from '@clef/rpc';
import { address } from '@solana/kit';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { anchorIdlAddress, AnchorOnchainIdlSource } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

function idlAccountData(json: string): Uint8Array {
  const compressed = zlibSync(new TextEncoder().encode(json));
  const data = new Uint8Array(44 + compressed.length);
  new DataView(data.buffer).setUint32(40, compressed.length, true);
  data.set(compressed, 44);
  return data;
}

describe('AnchorOnchainIdlSource', () => {
  it('loads and inflates the IDL account', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: await anchorIdlAddress(VAULT), owner: VAULT, data: idlAccountData(JSON.stringify(vault)) });
    const idl = await new AnchorOnchainIdlSource(reader).load(VAULT);
    expect(idl).toMatchObject({ source: 'anchor-onchain', trust: 'authority', programId: VAULT });
    expect(idl?.anchorExtras?.deposit).toBeDefined();
  });

  it('returns null when the program has no IDL account', async () => {
    expect(await new AnchorOnchainIdlSource(new MemoryChainReader()).load(VAULT)).toBeNull();
  });
});
