import type { AnchorSeed } from '@clef/idl';
import { parseAccountData } from '@codama/dynamic-parsers';
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, isAddress, type Address } from '@solana/kit';
import type { AccountCache } from './accounts';
import type { IdentifiedInstruction } from './identify';
import { displayBytes, errorDetail, Unresolvable } from './seeds';
import type { RelationEdge, SeedInfo } from './types';

/** Positive evidence of substitution: reported as `mismatch` rather than `unverified`. */
class Foreign extends Error {}

/** An account's decoded fields, or why they cannot be used. */
type Read = { data: Record<string, unknown> } | { status: 'unverified' | 'mismatch'; detail: string };
type Decode = (name: string) => Promise<Read>;

const failed = (read: Read): read is Exclude<Read, { data: unknown }> => !('data' in read);

/** Checks what Codama cannot express: Anchor `has_one` relations and PDAs with nested-path seeds. Never throws. */
export async function verifyAnchorExtras(ix: IdentifiedInstruction, cache: AccountCache): Promise<RelationEdge[]> {
  const idl = ix.resolvedIdl;
  const extras = ix.name ? idl?.anchorExtras?.[ix.name] : undefined;
  if (!idl || !extras) return [];

  // Accounts without a name (ambiguous positions) are never guessed.
  const byName = new Map(ix.accounts.filter((a) => a.name).map((a) => [a.name!, a.address]));
  const reads = new Map<string, Promise<Read>>();
  const read = async (name: string): Promise<Read> => {
    const address = byName.get(name);
    if (!address) return { status: 'unverified', detail: `could not read ${name}` };
    try {
      await cache.load([address]);
    } catch (e) {
      return { status: 'unverified', detail: `could not read ${name}: ${errorDetail(e)}` };
    }
    const account = cache.get(address);
    if (!account) return { status: 'unverified', detail: `could not read ${name}` };
    if (account.owner !== ix.programId) {
      // A look-alike owned by another program could carry the same discriminator and chosen fields.
      return { status: 'mismatch', detail: `${name} is not owned by the program` };
    }
    const parsed = parseAccountData(idl.root, account.data, { programAddress: ix.programId });
    if (!parsed || parsed.data === null || typeof parsed.data !== 'object') {
      return { status: 'unverified', detail: `could not read ${name}` };
    }
    return { data: parsed.data as Record<string, unknown> };
  };
  const decode: Decode = (name) => {
    let pending = reads.get(name);
    if (!pending) {
      pending = read(name).catch((e: unknown) => ({ status: 'unverified' as const, detail: errorDetail(e) }));
      reads.set(name, pending);
    }
    return pending;
  };

  const edges: RelationEdge[] = [];
  for (const [target, extra] of Object.entries(extras)) {
    const targetAddress = byName.get(target);
    if (!targetAddress) continue;

    for (const { holder, field } of extra.relations) {
      const holderAddress = byName.get(holder) ?? targetAddress;
      const label = `${holder}.${field}`;
      const base = { kind: 'has_one' as const, from: targetAddress, to: holderAddress, label, instructionIndex: ix.index };
      try {
        const result = await decode(holder);
        if (failed(result)) {
          edges.push({ ...base, status: result.status, detail: result.detail });
          continue;
        }
        const value = result.data[field];
        edges.push(
          value === targetAddress
            ? { ...base, status: 'verified' }
            : { ...base, status: 'mismatch', detail: `${label} is ${String(value)}` },
        );
      } catch (e) {
        edges.push({ ...base, status: 'unverified', detail: errorDetail(e) });
      }
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
      const result = await decode(head!);
      if (failed(result)) throw result.status === 'mismatch' ? new Foreign(result.detail) : new Unresolvable(result.detail);
      value = result.data;
    }
    for (const field of fields) value = (value as Record<string, unknown> | null | undefined)?.[field];
    if (typeof value !== 'string' || !isAddress(value)) {
      throw new Unresolvable(`seed ${seed.path.join('.')} is not a public key (only public-key nested seeds are supported)`);
    }
    return value;
  };

  let programAddress: Address | undefined;
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
    programAddress = seedProgram ? await resolveAddress(seedProgram) : ix.programId;
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
    return {
      kind: 'pda',
      from: targetAddress,
      to: programAddress ?? ix.programId,
      label: `PDA of ${target}`,
      status: e instanceof Foreign ? 'mismatch' : 'unverified',
      detail: errorDetail(e),
      instructionIndex: ix.index,
    };
  }
}
