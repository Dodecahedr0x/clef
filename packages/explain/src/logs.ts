import { type Address, isAddress } from '@solana/kit';
import { PROGRAM_NAMES } from './registry';
import { sanitizeText } from './text';
import type { LogKind, LogLine } from './types';

const INVOKE = /^Program (\S+) invoke \[(\d+)\]$/;
const SUCCESS = /^Program (\S+) success$/;
const FAILED = /^Program (\S+) failed: /;
const CONSUMED = /^Program (\S+) consumed (\d+) of (\d+) compute units$/;
const RETURN = /^Program return: (\S+) /;

function line(raw: string, kind: LogKind, depth: number, id?: string): LogLine {
  const out: LogLine = { depth: Math.max(0, depth), kind, text: sanitizeText(raw, 512) };
  if (id !== undefined && isAddress(id)) {
    out.programId = id as Address;
    const name = PROGRAM_NAMES[id];
    if (name !== undefined) out.programName = name;
  }
  return out;
}

/** Parses Solana runtime log lines (attacker-controlled) into display lines with invoke depth. Never throws. */
export function parseLogs(lines: readonly string[]): LogLine[] {
  const stack: string[] = [];
  const out: LogLine[] = [];
  for (const raw of lines) {
    if (raw.startsWith('Program log: ')) {
      out.push(line(raw, 'log', stack.length));
      continue;
    }
    if (raw.startsWith('Program data: ')) {
      out.push(line(raw, 'data', stack.length));
      continue;
    }
    let m = RETURN.exec(raw);
    if (m) {
      out.push(line(raw, 'return', stack.length, m[1]));
      continue;
    }
    if ((m = INVOKE.exec(raw))) {
      out.push(line(raw, 'invoke', Number(m[2]) - 1, m[1]));
      stack.push(m[1] ?? '');
      continue;
    }
    const end = SUCCESS.exec(raw);
    const fail = end ? null : FAILED.exec(raw);
    if (end ?? fail) {
      out.push(line(raw, end ? 'success' : 'failed', stack.length - 1, (end ?? fail)?.[1]));
      stack.pop();
      continue;
    }
    if ((m = CONSUMED.exec(raw))) {
      const l = line(raw, 'consumed', stack.length, m[1]);
      l.computeUnits = { consumed: Number(m[2]), budget: Number(m[3]) };
      out.push(l);
      continue;
    }
    out.push(line(raw, 'other', stack.length));
  }
  return out;
}
