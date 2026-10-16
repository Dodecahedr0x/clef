import { instructionNode, sizeDiscriminatorNode, type InstructionNode, type RootNode } from '@codama/nodes';
import ata from '../idls/associated-token-account.json' with { type: 'json' };
import computeBudget from '../idls/compute-budget.json' with { type: 'json' };
import memo from '../idls/memo.json' with { type: 'json' };
import squadsV4 from '../idls/squads-v4.json' with { type: 'json' };
import stake from '../idls/stake.json' with { type: 'json' };
import system from '../idls/system.json' with { type: 'json' };
import token2022 from '../idls/token-2022.json' with { type: 'json' };
import token from '../idls/token.json' with { type: 'json' };
import { StaticIdlSource } from './static-source';

// Memo v4 (Memo4c2p...) is wire-compatible with v3 (MemoSq4...), and the vendored IDL targets v4. Codama matches
// a program by its exact address, so the v3 alias needs its own root.
const memoV3 = { ...memo, program: { ...memo.program, publicKey: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' } };

/**
 * The ATA program still accepts `create` with empty instruction data (the pre-discriminator form, still sent
 * by older clients), which the vendored IDL cannot match. Add it as `createLegacy` -- `create`'s accounts, no
 * arguments, matched by empty data -- without editing the hash-pinned vendored file.
 */
function withLegacyAtaCreate(root: RootNode): RootNode {
  const instructions = root.program.instructions ?? [];
  const create = instructions.find((ix) => ix.name === 'create');
  if (!create) throw new Error('Bundled ATA IDL has no create instruction');
  const createLegacy: InstructionNode = instructionNode({
    name: 'createLegacy',
    docs: ['Legacy form of `create`, sent with empty instruction data.'],
    accounts: create.accounts ?? [],
    optionalAccountStrategy: create.optionalAccountStrategy,
    discriminators: [sizeDiscriminatorNode(0)],
  });
  return { ...root, program: { ...root.program, instructions: [...instructions, createLegacy] } };
}

const ataWithLegacyCreate = withLegacyAtaCreate(ata as unknown as RootNode);

const BUNDLED: { program: { publicKey: string } }[] = [
  system,
  token,
  token2022,
  ataWithLegacyCreate,
  computeBudget,
  memo,
  memoV3,
  stake,
  squadsV4,
];

/**
 * Programs Clef ships a curated IDL for. Security-sensitive: for these, any other IDL is ignored, so a user,
 * metadata or on-chain IDL can never rename what Clef's rules key on.
 */
export const BUNDLED_PROGRAM_IDS: ReadonlySet<string> = new Set(BUNDLED.map((idl) => idl.program.publicKey));

export function createBundledSource(): StaticIdlSource {
  return new StaticIdlSource('bundled', 'curated', new Map(BUNDLED.map((idl) => [idl.program.publicKey, idl])));
}
