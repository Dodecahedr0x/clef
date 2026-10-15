import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureChainReader, type TxMeta } from '@clef/rpc';
import { address, getBase64Encoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { defaultExplainContext, explain, viewFor, type Issue } from '../src';

/**
 * Real mainnet transactions recorded with `clef explain <sig> --level expert --record <file>`. Each replay runs
 * exactly what the CLI ran: the recorded `me` (the CLI writes the one it used, fee payer included), the recorded
 * labels, and the CLI's own context (`defaultExplainContext`).
 */
const dir = join(import.meta.dirname, 'fixtures/mainnet');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

type RecordedInput = { signature?: string; tx?: string; me: string[]; labels: Record<string, string> };

/** Non-IDL issues that are expected for a fixture, with the reason. */
const KNOWN_ISSUES: Record<string, { message: RegExp; why: string }[]> = {
  'stake-delegate': [
    {
      message: /^legacy stake account layout; names omitted$/,
      why: 'wallets still pass the sysvars the vendored (sysvar-free) stake IDL drops, so names after `stake` are withheld',
    },
  ],
};

async function replay(file: string) {
  const reader = FixtureChainReader.fromJson(readFileSync(join(dir, file), 'utf8'));
  const input = reader.input as RecordedInput;
  let wire: Uint8Array;
  let meta: TxMeta | null = null;
  if (input.signature) {
    const fetched = await reader.getTransaction(input.signature);
    if (!fetched) throw new Error(`${file}: transaction not recorded`);
    ({ wire, meta } = fetched);
  } else {
    wire = new Uint8Array(getBase64Encoder().encode(input.tx!));
  }
  return explain({ wire, meta }, defaultExplainContext(reader, input.me.map((m) => address(m)), input.labels));
}

describe.each(files)('mainnet fixture %s', (file) => {
  it('explains deterministically from recorded chain data', async () => {
    const ex = await replay(file);
    const known = KNOWN_ISSUES[file.replace(/\.json$/, '')] ?? [];
    const unexpected = (i: Issue) => i.stage !== 'idl' && !known.some((k) => k.message.test(i.message));

    expect(ex.issues.filter(unexpected)).toEqual([]);
    expect(ex.relations.filter((r) => r.status === 'mismatch')).toEqual([]);
    expect(ex.instructions.some((ix) => ix.name)).toBe(true);
    expect(viewFor(ex, 'expert')).toMatchSnapshot();
  });
});
