import { camelCase } from '@codama/nodes';

type V01Seed = { kind: 'const'; value: number[] } | { kind: 'arg' | 'account'; path: string; account?: string };
type V01LeafAccount = { name: string; relations?: string[]; pda?: { seeds: V01Seed[]; program?: V01Seed } };
type V01Account = V01LeafAccount | { name: string; accounts: V01Account[] };
type V01Idl = { metadata?: { spec?: string }; instructions: { name: string; accounts?: V01Account[] }[] };

export type AnchorSeed =
  | { kind: 'const'; bytes: number[] }
  /** `accountType`: the Anchor seed's `account` (the type of the path's head account), raw as in the IDL. */
  | { kind: 'arg' | 'account'; path: string[]; accountType?: string };

export type AnchorRelation = { holder: string; field: string };

export type AnchorAccountExtras = {
  /**
   * Anchor `has_one`: `holder` (the sibling account, named as Codama names it, i.e. prefixed inside duplicate
   * composites) stores this account's address in its struct field `field` (this account's own unprefixed name).
   */
  relations: AnchorRelation[];
  /**
   * Only set when a seed or the seed program uses a nested path (`pool.mint`), which Codama cannot represent.
   * When set, consumers must ignore Codama's `pdaValueNode` default for this account: it is either absent
   * (nested seeds) or wrong (nested `pda.program`, which Codama truncates to its first segment).
   */
  nestedSeeds?: AnchorSeed[];
  seedProgram?: AnchorSeed;
};

/** instruction name -> account name -> extras (all camelCase, matching Codama node names). */
export type AnchorExtras = Record<string, Record<string, AnchorAccountExtras>>;

type Leaf = { account: V01LeafAccount; prefix?: string };

/** Port of Codama's `hasDuplicateAccountNames` (v01): compares camelCased leaf names across the whole tree. */
function hasDuplicateAccountNames(accounts: V01Account[]): boolean {
  const seen = new Set<string>();
  const check = (items: V01Account[]): boolean =>
    items.some((item) => {
      if ('accounts' in item) return check(item.accounts);
      const name = camelCase(item.name);
      if (seen.has(name)) return true;
      seen.add(name);
      return false;
    });
  return check(accounts);
}

/** Mirrors Codama's `instructionAccountNodesFromAnchorV01` prefixing of composite children. */
function flatten(accounts: V01Account[], prefix?: string): Leaf[] {
  const shouldPrefix = prefix !== undefined || hasDuplicateAccountNames(accounts);
  return accounts.flatMap((a) =>
    'accounts' in a
      ? flatten(a.accounts, shouldPrefix ? (prefix ? `${prefix}_${a.name}` : a.name) : undefined)
      : [{ account: a, prefix: shouldPrefix ? prefix : undefined }],
  );
}

/** Sibling account name as Codama names it: `${prefix}_${name}`, camelCased. */
function sibling(name: string, prefix?: string): string {
  return camelCase(prefix ? `${prefix}_${name}` : name);
}

function isNested(seed: V01Seed): boolean {
  return seed.kind !== 'const' && seed.path.includes('.');
}

function toSeed(seed: V01Seed, prefix?: string): AnchorSeed {
  if (seed.kind === 'const') return { kind: 'const', bytes: seed.value };
  const [first = '', ...rest] = seed.path.split('.');
  // Like Codama's `pdaSeedNodeFromAnchorV01`: only account seeds get the prefix, on their first segment.
  const head = seed.kind === 'account' ? sibling(first, prefix) : camelCase(first);
  const path = [head, ...rest.map((p) => camelCase(p))];
  return seed.account === undefined ? { kind: seed.kind, path } : { kind: seed.kind, path, accountType: seed.account };
}

/** Recovers what `rootNodeFromAnchor` drops: has_one relations and nested-path PDA seeds. */
export function extractAnchorExtras(idl: unknown): AnchorExtras {
  const v = idl as V01Idl;
  if (v.metadata?.spec !== '0.1.0') return {}; // same V01 check as Codama; legacy IDLs have no extras
  const out: AnchorExtras = {};
  for (const ix of v.instructions) {
    const entries: Record<string, AnchorAccountExtras> = {};
    for (const { account: acc, prefix } of flatten(ix.accounts ?? [])) {
      const field = camelCase(acc.name);
      const relations = (acc.relations ?? []).map((r) => ({ holder: sibling(r, prefix), field }));
      const seeds = acc.pda?.seeds ?? [];
      const program = acc.pda?.program;
      const nested = seeds.some(isNested) || (program !== undefined && isNested(program));
      if (!relations.length && !nested) continue;
      const extras: AnchorAccountExtras = { relations };
      if (nested) {
        extras.nestedSeeds = seeds.map((s) => toSeed(s, prefix));
        if (program) extras.seedProgram = toSeed(program, prefix);
      }
      entries[sibling(acc.name, prefix)] = extras;
    }
    if (Object.keys(entries).length) out[camelCase(ix.name)] = entries;
  }
  return out;
}
