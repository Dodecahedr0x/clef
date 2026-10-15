import { normalizeIdl, UserIdlSource, IdlResolver, type ResolvedIdl } from '@clef/idl';
import type { MemoryChainReader } from '@clef/rpc';
import { getNodeCodec } from '@codama/dynamic-codecs';
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import type { DecodedInstruction } from '../src';
import vaultJson from './fixtures/vault-anchor.json' with { type: 'json' };
import { ME, OTHER, USDC } from './helpers';

export const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
export const AUTHORITY = address('HvwC9QSAzvGXhhVrgPmauVwFWcYZhne3hVot9EbHuFTm');
const enc = getAddressEncoder();

/** Codama dynamic codecs take bytes as an `[encoding, data]` tuple; discriminators must be passed explicitly. */
const bytesValue = (bytes: number[]) => ['base16', bytes.map((b) => b.toString(16).padStart(2, '0')).join('')];

export async function vaultIdl(): Promise<ResolvedIdl> {
  return { programId: VAULT, source: 'user', trust: 'user', ...(await normalizeIdl(vaultJson)) };
}

export function vaultResolver(): IdlResolver {
  const user = new UserIdlSource();
  user.set(VAULT, JSON.stringify(vaultJson));
  return new IdlResolver([user]);
}

export async function vaultAddresses(mint: Address = USDC) {
  const [pool] = await getProgramDerivedAddress({ programAddress: VAULT, seeds: ['pool', enc.encode(mint)] });
  const [poolVault] = await getProgramDerivedAddress({ programAddress: VAULT, seeds: ['vault', enc.encode(pool)] });
  const [userPosition] = await getProgramDerivedAddress({ programAddress: VAULT, seeds: ['pos', enc.encode(mint), enc.encode(ME)] });
  return { user: ME, pool, mint, poolVault, userPosition, authority: AUTHORITY };
}

type VaultAccounts = Awaited<ReturnType<typeof vaultAddresses>>;

export async function depositInstruction(accounts: VaultAccounts, amount = 5n): Promise<DecodedInstruction> {
  const idl = await vaultIdl();
  const ixNode = (idl.root.program.instructions ?? [])[0]!;
  const data = getNodeCodec([idl.root, idl.root.program, ixNode]).encode({
    discriminator: bytesValue(vaultJson.instructions[0]!.discriminator),
    amount,
  });
  const flags: Record<string, [boolean, boolean]> = {
    user: [true, true], pool: [false, false], mint: [false, false],
    poolVault: [false, true], userPosition: [false, true], authority: [false, false],
  };
  return {
    index: 0,
    programId: VAULT,
    data: new Uint8Array(data),
    accounts: (Object.keys(flags) as (keyof VaultAccounts)[]).map((name) => ({
      address: accounts[name],
      signer: flags[name]![0],
      writable: flags[name]![1],
    })),
  };
}

/** Stores the Pool account (owned by the vault program unless `owner` is given) with the given fields. */
export async function setPool(
  reader: MemoryChainReader,
  pool: Address,
  fields: { mint: Address; authority: Address },
  owner: Address = VAULT,
) {
  const idl = await vaultIdl();
  const accountNode = (idl.root.program.accounts ?? [])[0]!;
  const data = getNodeCodec([idl.root, idl.root.program, accountNode]).encode({
    discriminator: bytesValue(vaultJson.accounts[0]!.discriminator),
    ...fields,
    bump: 255,
  });
  reader.setAccount({ address: pool, owner, data: new Uint8Array(data) });
}

export { OTHER };
