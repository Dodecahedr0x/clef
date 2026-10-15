import { getNodeCodecVisitor, getValueNodeVisitor } from '@codama/dynamic-codecs';
import { isNode, type PdaNode, type RootNode } from '@codama/nodes';
import { getRecordLinkablesVisitor, LinkableDictionary, visit } from '@codama/visitors-core';
import { getProgramDerivedAddress, type Address } from '@solana/kit';
import type { IdentifiedInstruction } from './identify';
import { instructionNodes, isAbsent, programs } from './idl-lookup';
import { displayBytes, errorDetail, Unresolvable } from './seeds';
import type { RelationEdge, SeedInfo } from './types';

type Visitors = { codec: ReturnType<typeof getNodeCodecVisitor>; value: ReturnType<typeof getValueNodeVisitor> };
const visitorsCache = new WeakMap<RootNode, Visitors>();

function visitorsFor(root: RootNode): Visitors {
  let v = visitorsCache.get(root);
  if (!v) {
    const linkables = new LinkableDictionary();
    visit(root, getRecordLinkablesVisitor(linkables));
    v = { codec: getNodeCodecVisitor(linkables), value: getValueNodeVisitor(linkables) };
    visitorsCache.set(root, v);
  }
  return v;
}

/** Re-derives every PDA declared on the instruction's accounts and compares it to what was passed. */
export async function verifyCodamaPdas(ix: IdentifiedInstruction): Promise<RelationEdge[]> {
  const idl = ix.resolvedIdl;
  const nodes = instructionNodes(ix);
  if (!idl || !ix.name || !nodes) return [];
  const { program, node } = nodes;

  // Accounts without a name (ambiguous positions) are never guessed: they neither get edges nor serve as seeds.
  const byName = new Map(ix.accounts.filter((a) => a.name).map((a) => [a.name!, a.address]));
  const extras = idl.anchorExtras?.[ix.name];
  // Seeds come from the raw args: sanitized display strings can differ from what was derived.
  const args = ix.rawArgs ?? {};
  const edges: RelationEdge[] = [];

  for (const accountNode of node.accounts ?? []) {
    const dv = accountNode.defaultValue;
    const actual = byName.get(accountNode.name);
    if (!dv || !isNode(dv, 'pdaValueNode') || !actual || isAbsent(ix, accountNode.name)) continue;
    // Codama's default is absent or wrong for nested-path seeds: `verifyAnchorExtras` handles these.
    if (extras?.[accountNode.name]?.nestedSeeds) continue;

    const seeds: SeedInfo[] = [];
    let programAddress: Address | undefined;
    try {
      const { codec, value } = visitorsFor(idl.root);
      let pda: PdaNode | undefined;
      let pdaProgram = program;
      if (isNode(dv.pda, 'pdaNode')) {
        pda = dv.pda;
      } else {
        const linked = dv.pda.program?.name;
        const owner = linked ? programs(idl.root).find((p) => p.name === linked) : program;
        if (!owner) continue;
        pdaProgram = owner;
        pda = (owner.pdas ?? []).find((p) => p.name === dv.pda.name);
      }
      if (!pda) continue;
      const pdaProgramAddress = (pda.programId ?? pdaProgram.publicKey) as Address;

      const encoded: Uint8Array[] = [];
      for (const seed of pda.seeds ?? []) {
        const seedCodec = visit(seed.type, codec);
        if (isNode(seed, 'constantPdaSeedNode')) {
          // `programIdValueNode` (the deriving program's own address) is not a plain value the visitor can produce.
          const constant = isNode(seed.value, 'programIdValueNode') ? pdaProgramAddress : visit(seed.value, value);
          const bytes = new Uint8Array(seedCodec.encode(constant));
          encoded.push(bytes);
          seeds.push({ kind: 'const', display: displayBytes(bytes) });
          continue;
        }
        const seedValue = (dv.seeds ?? []).find((s) => s.name === seed.name)?.value;
        if (!seedValue) throw new Unresolvable(`seed "${seed.name}" has no value`);
        let resolved: unknown;
        if (isNode(seedValue, 'accountValueNode')) {
          if (isAbsent(ix, seedValue.name)) throw new Unresolvable(`${seedValue.name} not provided`);
          resolved = byName.get(seedValue.name);
          if (!resolved) throw new Unresolvable(`account "${seedValue.name}" is not in the instruction`);
          seeds.push({ kind: 'account', display: seedValue.name });
        } else if (isNode(seedValue, 'argumentValueNode')) {
          if (!Object.hasOwn(args, seedValue.name)) throw new Unresolvable(`argument "${seedValue.name}" is missing`);
          resolved = args[seedValue.name];
          seeds.push({ kind: 'arg', display: seedValue.name });
        } else {
          resolved = visit(seedValue, value);
          seeds.push({ kind: 'const', display: String(resolved) });
        }
        encoded.push(new Uint8Array(seedCodec.encode(resolved)));
      }

      programAddress = pdaProgramAddress;
      if (dv.programId && isNode(dv.programId, 'accountValueNode')) {
        if (isAbsent(ix, dv.programId.name)) throw new Unresolvable(`${dv.programId.name} not provided`);
        const fromAccount = byName.get(dv.programId.name);
        if (!fromAccount) throw new Unresolvable(`program account "${dv.programId.name}" is not in the instruction`);
        programAddress = fromAccount;
      }
      const [expected, bump] = await getProgramDerivedAddress({ programAddress, seeds: encoded });
      edges.push({
        kind: 'pda',
        from: actual,
        to: programAddress,
        label: `PDA(${seeds.map((s) => s.display).join(', ')})`,
        status: expected === actual ? 'verified' : 'mismatch',
        instructionIndex: ix.index,
        seeds,
        bump,
        ...(expected !== actual && { detail: `expected ${expected}` }),
      });
    } catch (e) {
      // Hostile or unusual IDLs must not abort the explanation: any failure leaves this one PDA unverified.
      edges.push({
        kind: 'pda',
        from: actual,
        to: programAddress ?? (program.publicKey as Address),
        label: 'PDA',
        status: 'unverified',
        detail: errorDetail(e),
        instructionIndex: ix.index,
      });
    }
  }
  return edges;
}
