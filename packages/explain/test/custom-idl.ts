import { IdlResolver, normalizeIdl, UserIdlSource } from '@clef/idl';
import { getNodeCodec } from '@codama/dynamic-codecs';
import type { RootNode } from '@codama/nodes';
import type { Address } from '@solana/kit';
import { identifyInstruction, type IdentifiedInstruction } from '../src';
import { VAULT } from './vault';

/** Throwaway Anchor/Codama IDLs for edge cases, all bound to the vault program id. */
export const PROG = VAULT;
export const IX_DISC = [1, 2, 3, 4, 5, 6, 7, 8];
export const POOL_DISC = [9, 9, 9, 9, 9, 9, 9, 9];

export const bytesValue = (bytes: number[]) => ['base16', bytes.map((b) => b.toString(16).padStart(2, '0')).join('')];

/** An Anchor v0.1.0 IDL with one instruction `go` and a `Pool { mint, authority }` account type. */
export function anchorIdl(accounts: unknown[], args: unknown[] = []) {
  return {
    address: PROG,
    metadata: { name: 'p', version: '0.1.0', spec: '0.1.0' },
    instructions: [{ name: 'go', discriminator: IX_DISC, accounts, args }],
    accounts: [{ name: 'Pool', discriminator: POOL_DISC }],
    types: [
      {
        name: 'Pool',
        type: { kind: 'struct', fields: [{ name: 'mint', type: 'pubkey' }, { name: 'authority', type: 'pubkey' }] },
      },
    ],
  };
}

/** Encodes and identifies the IDL's first instruction with the given accounts (by position) and arguments. */
export async function customIx(
  json: object,
  addresses: Address[],
  args: Record<string, unknown> = {},
  writable: ReadonlySet<number> = new Set(),
): Promise<IdentifiedInstruction> {
  const { root } = await normalizeIdl(json);
  const ixNode = (root.program.instructions ?? [])[0]!;
  const data = getNodeCodec([root, root.program, ixNode]).encode({ discriminator: bytesValue(IX_DISC), ...args });
  const user = new UserIdlSource();
  user.set(PROG, JSON.stringify(json));
  return identifyInstruction(
    {
      index: 0,
      programId: PROG,
      data: new Uint8Array(data),
      accounts: addresses.map((address, i) => ({ address, signer: false, writable: writable.has(i) })),
    },
    new IdlResolver([user]),
    [],
  );
}

/** `Pool` account data for an IDL built by `anchorIdl`. */
export async function poolData(json: object, mint: Address, authority: Address): Promise<Uint8Array> {
  const root: RootNode = (await normalizeIdl(json)).root;
  const node = (root.program.accounts ?? [])[0]!;
  return new Uint8Array(getNodeCodec([root, root.program, node]).encode({ discriminator: bytesValue(POOL_DISC), mint, authority }));
}
