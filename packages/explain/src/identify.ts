import type { IdlResolver, ResolvedIdl } from '@clef/idl';
import { parseInstruction } from '@codama/dynamic-parsers';
import { findProgramNodeFromPath, getLastNodeFromPath } from '@codama/visitors-core';
import { AccountRole } from '@solana/kit';
import type { DecodedInstruction, ExplainedInstruction, Issue } from './types';

function role(a: { signer: boolean; writable: boolean }): AccountRole {
  return ((a.signer ? 2 : 0) | (a.writable ? 1 : 0)) as AccountRole;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type IdentifiedInstruction = ExplainedInstruction & { resolvedIdl?: ResolvedIdl };

/** Tries each candidate IDL in priority order; the first one that decodes the instruction wins. */
export async function identifyInstruction(
  ix: DecodedInstruction,
  idls: IdlResolver,
  issues: Issue[],
): Promise<IdentifiedInstruction> {
  const raw: IdentifiedInstruction = {
    index: ix.index,
    programId: ix.programId,
    accounts: ix.accounts.map((a) => ({ ...a, mine: false })),
    data: ix.data,
  };
  const onError = (e: { source: string; message: string }) =>
    issues.push({ stage: 'idl', instructionIndex: ix.index, message: `${e.source}: ${e.message}` });

  for await (const idl of idls.candidates(ix.programId, onError)) {
    try {
      const parsed = parseInstruction(idl.root, {
        programAddress: ix.programId,
        accounts: ix.accounts.map((a) => ({ address: a.address, role: role(a) })),
        data: ix.data,
      });
      if (!parsed) continue;
      const node = getLastNodeFromPath(parsed.path);
      const named = parsed.accounts.length;
      return {
        ...raw,
        name: node.name,
        programName: findProgramNodeFromPath(parsed.path)?.name,
        args: parsed.data as Record<string, unknown>,
        idl: { source: idl.source, trust: idl.trust, hash: idl.hash },
        accounts: raw.accounts.map((a, i) => ({
          ...a,
          name: i < named ? parsed.accounts[i]!.name : `remaining${i - named}`,
        })),
        resolvedIdl: idl,
      };
    } catch (e) {
      issues.push({ stage: 'parse', instructionIndex: ix.index, message: `${idl.source} IDL failed to decode: ${message(e)}` });
    }
  }
  return raw;
}
