import { camelCase } from '@codama/nodes';

type V01Seed = { kind: 'const'; value: number[] } | { kind: 'arg' | 'account'; path: string; account?: string };
type V01LeafAccount = { name: string; relations?: string[]; pda?: { seeds: V01Seed[]; program?: V01Seed } };
type V01Account = V01LeafAccount | { name: string; accounts: V01Account[] };
type V01Idl = { address?: string; instructions: { name: string; accounts?: V01Account[] }[] };

export type AnchorSeed = { kind: 'const'; bytes: number[] } | { kind: 'arg' | 'account'; path: string[] };

export type AnchorAccountExtras = {
  /** Accounts that hold a field (named like this account) which must equal this account — Anchor `has_one`. */
  relations: string[];
  /** Only set when a seed uses a nested path (`pool.mint`), which Codama cannot represent. */
  nestedSeeds?: AnchorSeed[];
  seedProgram?: AnchorSeed;
};

/** instruction name → account name → extras (all camelCase, matching Codama node names). */
export type AnchorExtras = Record<string, Record<string, AnchorAccountExtras>>;

function flatten(accounts: V01Account[]): V01LeafAccount[] {
  return accounts.flatMap((a) => ('accounts' in a ? flatten(a.accounts) : [a]));
}

function toSeed(seed: V01Seed): AnchorSeed {
  return seed.kind === 'const'
    ? { kind: 'const', bytes: seed.value }
    : { kind: seed.kind, path: seed.path.split('.').map((p) => camelCase(p)) };
}

/** Recovers what `rootNodeFromAnchor` drops: has_one relations and nested-path PDA seeds. */
export function extractAnchorExtras(idl: unknown): AnchorExtras {
  const v = idl as V01Idl;
  if (typeof v.address !== 'string') return {}; // legacy IDL format: no extras
  const out: AnchorExtras = {};
  for (const ix of v.instructions) {
    const flat = flatten(ix.accounts ?? []);
    const names = flat.map((a) => a.name);
    // Codama prefixes duplicate names inside composite accounts; skip instead of guessing.
    if (new Set(names).size !== names.length) continue;

    const entries: Record<string, AnchorAccountExtras> = {};
    for (const acc of flat) {
      const relations = (acc.relations ?? []).map((r) => camelCase(r));
      const seeds = acc.pda?.seeds ?? [];
      const nested = seeds.some((s) => s.kind !== 'const' && s.path.includes('.'));
      if (!relations.length && !nested) continue;
      const extras: AnchorAccountExtras = { relations };
      if (nested) {
        extras.nestedSeeds = seeds.map(toSeed);
        if (acc.pda?.program) extras.seedProgram = toSeed(acc.pda.program);
      }
      entries[camelCase(acc.name)] = extras;
    }
    if (Object.keys(entries).length) out[camelCase(ix.name)] = entries;
  }
  return out;
}
