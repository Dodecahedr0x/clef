import type { InstructionAccountNode, InstructionNode, ProgramNode, RootNode } from '@codama/nodes';
import type { IdentifiedInstruction } from './identify';

export function programs(root: RootNode): ProgramNode[] {
  return [root.program, ...(root.additionalPrograms ?? [])];
}

/** The instruction's own program node and Codama instruction node, if its IDL has them. */
export function instructionNodes(ix: IdentifiedInstruction): { program: ProgramNode; node: InstructionNode } | undefined {
  const root = ix.resolvedIdl?.root;
  if (!root || !ix.name) return undefined;
  const program = programs(root).find((p) => p.publicKey === ix.programId);
  const node = (program?.instructions ?? []).find((i) => i.name === ix.name);
  return program && node ? { program, node } : undefined;
}

export function accountNode(ix: IdentifiedInstruction, name: string): InstructionAccountNode | undefined {
  return (instructionNodes(ix)?.node.accounts ?? []).find((a) => a.name === name);
}

/**
 * True when `name` is an optional account that was left out: with the `programId` strategy (Codama's default)
 * an omitted optional account is passed as the program's own address.
 */
export function isAbsent(ix: IdentifiedInstruction, name: string): boolean {
  const nodes = instructionNodes(ix);
  const account = (nodes?.node.accounts ?? []).find((a) => a.name === name);
  if (!nodes || !account?.isOptional) return false;
  if ((nodes.node.optionalAccountStrategy ?? 'programId') !== 'programId') return false;
  return ix.accounts.find((a) => a.name === name)?.address === ix.programId;
}
