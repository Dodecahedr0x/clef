import type { IdlResolver, ResolvedIdl } from '@clef/idl';
import type { InstructionNode } from '@codama/nodes';
import { parseInstruction } from '@codama/dynamic-parsers';
import { findProgramNodeFromPath, getLastNodeFromPath } from '@codama/visitors-core';
import { AccountRole } from '@solana/kit';
import { sanitizeText } from './text';
import type { DecodedInstruction, ExplainedInstruction, Issue } from './types';

/** String args (e.g. memos) are content, not labels: allow more than a name's length. */
const ARG_TEXT_MAX = 1024;

function role(a: { signer: boolean; writable: boolean }): AccountRole {
  return ((a.signer ? 2 : 0) | (a.writable ? 1 : 0)) as AccountRole;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Sanitizes every string inside decoded args (plain objects and arrays); other values pass through. */
function sanitizeArgs(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeText(value, ARG_TEXT_MAX);
  if (Array.isArray(value)) return value.map(sanitizeArgs);
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [sanitizeText(k), sanitizeArgs(v)]));
    }
  }
  return value;
}

/**
 * Account names by position. With the "omitted" strategy, a missing optional account shifts every later one.
 * So when an optional account precedes a required one, names from the first optional account on cannot be
 * known if accounts are missing, or if trailing remaining accounts (e.g. multisig signers) could be filling
 * the gap.
 */
function accountNames(node: InstructionNode, count: number, ixIndex: number, issues: Issue[]): (string | undefined)[] {
  const declared = (node.accounts ?? []).map((a) => ({ name: sanitizeText(a.name), optional: !!a.isOptional }));
  const names: (string | undefined)[] = Array.from({ length: count }, (_, i) =>
    i < declared.length ? declared[i]!.name : `remaining${i - declared.length}`,
  );

  const required = declared.filter((a) => !a.optional).length;
  if (count < required) {
    issues.push({
      stage: 'parse',
      instructionIndex: ixIndex,
      message: `${sanitizeText(node.name)} expects at least ${required} accounts, got ${count}`,
    });
  }

  const firstOptional = declared.findIndex((a) => a.optional);
  const hasRemaining = (node.remainingAccounts ?? []).length > 0;
  const ambiguous =
    node.optionalAccountStrategy === 'omitted' &&
    (count < declared.length || hasRemaining) &&
    firstOptional >= 0 &&
    declared.slice(firstOptional).some((a) => !a.optional) &&
    count > firstOptional;
  if (ambiguous) {
    names.fill(undefined, firstOptional);
    const after = firstOptional > 0 ? `account names after ${declared[firstOptional - 1]!.name}` : 'all account names';
    issues.push({ stage: 'parse', instructionIndex: ixIndex, message: `optional accounts omitted; ${after} are ambiguous` });
  }
  return names;
}

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
  const unmatched: string[] = [];

  for await (const idl of idls.candidates(ix.programId, onError)) {
    try {
      const parsed = parseInstruction(idl.root, {
        programAddress: ix.programId,
        accounts: ix.accounts.map((a) => ({ address: a.address, role: role(a) })),
        data: ix.data,
      });
      if (!parsed) {
        unmatched.push(idl.source);
        continue;
      }
      const node = getLastNodeFromPath(parsed.path);
      const programName = findProgramNodeFromPath(parsed.path)?.name;
      const names = accountNames(node, ix.accounts.length, ix.index, issues);
      return {
        ...raw,
        name: sanitizeText(node.name),
        programName: programName === undefined ? undefined : sanitizeText(programName),
        args: sanitizeArgs(parsed.data) as Record<string, unknown>,
        idl: { source: idl.source, trust: idl.trust, hash: idl.hash },
        accounts: raw.accounts.map((a, i) => ({ ...a, name: names[i] })),
        resolvedIdl: idl,
      };
    } catch (e) {
      issues.push({ stage: 'parse', instructionIndex: ix.index, message: `${idl.source} IDL failed to decode: ${message(e)}` });
    }
  }
  if (unmatched.length) {
    issues.push({ stage: 'parse', instructionIndex: ix.index, message: `no instruction in ${unmatched.join(', ')} IDL matched` });
  }
  return raw;
}
