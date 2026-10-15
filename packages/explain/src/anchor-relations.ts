import type { AnchorSeed } from '@clef/idl';
import { parseAccountData } from '@codama/dynamic-parsers';
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, isAddress, type Address } from '@solana/kit';
import type { AccountCache } from './accounts';
import type { IdentifiedInstruction } from './identify';
import { displayBytes } from './pda';
import type { RelationEdge, SeedInfo } from './types';

class Unresolvable extends Error {}
/** Positive evidence of substitution: the account is not the program's state. */
class Foreign extends Error {}

type Holder = { data: Record<string, unknown> } | { failure: 'unreadable' | 'foreign' };
type Decode = (name: string) => Promise<Holder>;

const foreign = (name: string) => `${name} is not owned by the program`;

/** Checks what Codama cannot express: Anchor `has_one` relations and PDAs with nested-path seeds. */
export async function verifyAnchorExtras(ix: IdentifiedInstruction, cache: AccountCache): Promise<RelationEdge[]> {
  const idl = ix.resolvedIdl;
  const extras = ix.name ? idl?.anchorExtras?.[ix.name] : undefined;
  if (!idl || !extras) return [];

  // Accounts without a name (ambiguous positions) are never guessed.
  const byName = new Map(ix.accounts.filter((a) => a.name).map((a) => [a.name!, a.address]));
  const decoded = new Map<string, Holder>();
  const decode: Decode = async (name) => {
    const cached = decoded.get(name);
    if (cached) return cached;
    let holder: Holder = { failure: 'unreadable' };
    const address = byName.get(name);
    if (address) {
      await cache.load([address]);
      const account = cache.get(address);
      if (account && account.owner !== ix.programId) {
        // A look-alike owned by another program could carry the same discriminator and chosen fields.
        holder = { failure: 'foreign' };
      } else if (account) {
        const parsed = parseAccountData(idl.root, account.data, { programAddress: ix.programId });
        if (parsed && parsed.data !== null && typeof parsed.data === 'object') {
          holder = { data: parsed.data as Record<string, unknown> };
        }
      }
    }
    decoded.set(name, holder);
    return holder;
  };

  const edges: RelationEdge[] = [];
  for (const [target, extra] of Object.entries(extras)) {
    const targetAddress = byName.get(target);
    if (!targetAddress) continue;

    for (const { holder, field } of extra.relations) {
      const holderAddress = byName.get(holder) ?? targetAddress;
      const label = `${holder}.${field}`;
      const base = { kind: 'has_one' as const, from: targetAddress, to: holderAddress, label, instructionIndex: ix.index };
      const read = await decode(holder);
      if ('failure' in read) {
        edges.push(
          read.failure === 'foreign'
            ? { ...base, status: 'mismatch', detail: foreign(holder) }
            : { ...base, status: 'unverified', detail: `could not read ${holder}` },
        );
        continue;
      }
      const value = read.data[field];
      edges.push(
        value === targetAddress
          ? { ...base, status: 'verified' }
          : { ...base, status: 'mismatch', detail: `${label} is ${String(value)}` },
      );
    }

    if (extra.nestedSeeds) {
      edges.push(await verifyNestedSeeds(ix, target, targetAddress, extra.nestedSeeds, extra.seedProgram, byName, decode));
    }
  }
  return edges;
}

async function verifyNestedSeeds(
  ix: IdentifiedInstruction,
  target: string,
  targetAddress: Address,
  seeds: AnchorSeed[],
  seedProgram: AnchorSeed | undefined,
  byName: Map<string, Address>,
  decode: Decode,
): Promise<RelationEdge> {
  const resolveAddress = async (seed: AnchorSeed): Promise<Address> => {
    if (seed.kind === 'const') {
      if (seed.bytes.length !== 32) throw new Unresolvable('seed program is not a public key');
      return getAddressDecoder().decode(new Uint8Array(seed.bytes));
    }
    const [head, ...fields] = seed.path;
    let value: unknown;
    if (seed.kind === 'arg') value = ix.args?.[head!];
    else if (!fields.length) value = byName.get(head!);
    else {
      const read = await decode(head!);
      if ('failure' in read) {
        if (read.failure === 'foreign') throw new Foreign(foreign(head!));
        throw new Unresolvable(`could not read ${head}`);
      }
      value = read.data;
    }
    for (const field of fields) value = (value as Record<string, unknown> | null | undefined)?.[field];
    if (typeof value !== 'string' || !isAddress(value)) {
      throw new Unresolvable(`seed ${seed.path.join('.')} is not a public key (only public-key nested seeds are supported)`);
    }
    return value;
  };

  const programId = ix.programId;
  const info: SeedInfo[] = [];
  try {
    const encoded: Uint8Array[] = [];
    for (const seed of seeds) {
      if (seed.kind === 'const') {
        const bytes = new Uint8Array(seed.bytes);
        encoded.push(bytes);
        info.push({ kind: 'const', display: displayBytes(bytes) });
      } else {
        encoded.push(new Uint8Array(getAddressEncoder().encode(await resolveAddress(seed))));
        info.push({ kind: seed.kind, display: seed.path.join('.') });
      }
    }
    const programAddress = seedProgram ? await resolveAddress(seedProgram) : programId;
    const [expected, bump] = await getProgramDerivedAddress({ programAddress, seeds: encoded });
    return {
      kind: 'pda',
      from: targetAddress,
      to: programAddress,
      label: `PDA(${info.map((s) => s.display).join(', ')})`,
      status: expected === targetAddress ? 'verified' : 'mismatch',
      instructionIndex: ix.index,
      seeds: info,
      bump,
      ...(expected !== targetAddress && { detail: `expected ${expected}` }),
    };
  } catch (e) {
    const base = { kind: 'pda' as const, from: targetAddress, to: programId, label: `PDA of ${target}`, instructionIndex: ix.index };
    if (e instanceof Foreign) return { ...base, status: 'mismatch', detail: e.message };
    if (e instanceof Unresolvable) return { ...base, status: 'unverified', detail: e.message };
    throw e;
  }
}
