import { sanitizeText } from '@clef/explain';
import type { ResolvedIdl } from '@clef/idl';

type RootNode = ResolvedIdl['root'];

/** Everything an IDL declares, as display strings (IDL text is untrusted: every string is sanitized). */
export type IdlOutline = {
  name: string;
  version: string | null;
  instructions: {
    name: string;
    docs: string;
    discriminator: string | null;
    args: { name: string; type: string }[];
    accounts: { name: string; flags: string[]; docs: string }[];
  }[];
  accounts: { name: string; docs: string; fields: { name: string; type: string }[] }[];
  types: { name: string; docs: string; type: string }[];
  pdas: { name: string; seeds: string[] }[];
  errors: { code: number; name: string; message: string }[];
};

type Node = { kind: string; [k: string]: unknown };

const clean = (s: unknown, max = 120) => (typeof s === 'string' ? sanitizeText(s, max) : '');
const docsOf = (n: Node) => (Array.isArray(n.docs) ? n.docs.map((d) => clean(d, 300)).join(' ') : '');

/** A compact, readable type: `u64`, `Option<pubkey>`, `[u8; 32]`, `Vec<Order>`, `{ a: u8, b: bool }`. */
export function typeName(t: unknown, depth = 0): string {
  const n = t as Node | null;
  if (!n || typeof n !== 'object') return '?';
  if (depth > 6) return '…';
  const sub = (x: unknown) => typeName(x, depth + 1);
  switch (n.kind) {
    case 'numberTypeNode':
      return clean(n.format, 12);
    case 'publicKeyTypeNode':
      return 'pubkey';
    case 'booleanTypeNode':
      return 'bool';
    case 'stringTypeNode':
      return 'string';
    case 'bytesTypeNode':
      return 'bytes';
    case 'definedTypeLinkNode':
    case 'accountLinkNode':
      return clean(n.name, 48);
    case 'optionTypeNode':
    case 'zeroableOptionTypeNode':
      return `Option<${sub(n.item)}>`;
    case 'arrayTypeNode': {
      const count = n.count as Node | undefined;
      return count?.kind === 'fixedCountNode' ? `[${sub(n.item)}; ${String(count.value)}]` : `Vec<${sub(n.item)}>`;
    }
    case 'setTypeNode':
      return `Set<${sub(n.item)}>`;
    case 'mapTypeNode':
      return `Map<${sub(n.key)}, ${sub(n.value)}>`;
    case 'tupleTypeNode':
      return `(${((n.items as unknown[]) ?? []).map(sub).join(', ')})`;
    case 'structTypeNode':
      return `{ ${((n.fields as Node[]) ?? []).map((f) => `${clean(f.name, 48)}: ${sub(f.type)}`).join(', ')} }`;
    case 'enumTypeNode':
      return ((n.variants as Node[]) ?? []).map((v) => clean(v.name, 48)).join(' | ') || 'enum';
    case 'fixedSizeTypeNode':
      return n.type && (n.type as Node).kind === 'bytesTypeNode' ? `[u8; ${String(n.size)}]` : sub(n.type);
    case 'sizePrefixTypeNode':
    case 'hiddenPrefixTypeNode':
    case 'hiddenSuffixTypeNode':
    case 'preOffsetTypeNode':
    case 'postOffsetTypeNode':
    case 'sentinelTypeNode':
      return sub(n.type);
    case 'amountTypeNode':
    case 'dateTimeTypeNode':
    case 'solAmountTypeNode':
      return sub(n.number);
    default:
      return clean(n.kind.replace(/TypeNode$/, ''), 32) || '?';
  }
}

function discriminatorOf(ix: Node): string | null {
  const arg = ((ix.arguments as Node[]) ?? []).find((a) => a.name === 'discriminator');
  const value = arg?.defaultValue as Node | undefined;
  if (value?.kind === 'bytesValueNode' && typeof value.data === 'string') return clean(value.data, 64);
  if (value?.kind === 'numberValueNode') return String(value.number);
  return null;
}

function seedText(seed: Node): string {
  if (seed.kind === 'variablePdaSeedNode') return `${clean(seed.name, 48)}: ${typeName(seed.type)}`;
  const value = seed.value as Node | undefined;
  if (value?.kind === 'stringValueNode') return `"${clean(value.string, 64)}"`;
  if (value?.kind === 'bytesValueNode') return `0x${clean(value.data, 64)}`;
  if (value?.kind === 'programIdValueNode') return 'program id';
  return typeName(seed.type);
}

export function outlineIdl(root: RootNode): IdlOutline {
  const p = root.program as unknown as Node & { instructions: Node[]; accounts: Node[]; definedTypes: Node[]; pdas: Node[]; errors: Node[] };
  return {
    name: clean(p.name, 64) || 'Unknown program',
    version: typeof p.version === 'string' ? clean(p.version, 32) : null,
    instructions: (p.instructions ?? []).map((ix) => ({
      name: clean(ix.name, 64),
      docs: docsOf(ix),
      discriminator: discriminatorOf(ix),
      args: ((ix.arguments as Node[]) ?? []).filter((a) => a.name !== 'discriminator').map((a) => ({ name: clean(a.name, 48), type: typeName(a.type) })),
      accounts: ((ix.accounts as Node[]) ?? []).map((a) => ({
        name: clean(a.name, 48),
        docs: docsOf(a),
        flags: [
          ...(a.isWritable ? ['writable'] : []),
          ...(a.isSigner === true ? ['signer'] : a.isSigner === 'either' ? ['signer?'] : []),
          ...(a.isOptional ? ['optional'] : []),
          ...((a.defaultValue as Node | undefined)?.kind === 'pdaValueNode' ? ['pda'] : []),
        ],
      })),
    })),
    accounts: (p.accounts ?? []).map((a) => {
      const data = a.data as Node | undefined;
      const fields = data?.kind === 'structTypeNode' ? (data.fields as Node[]) : [];
      return { name: clean(a.name, 64), docs: docsOf(a), fields: fields.filter((f) => f.name !== 'discriminator').map((f) => ({ name: clean(f.name, 48), type: typeName(f.type) })) };
    }),
    types: (p.definedTypes ?? []).map((t) => ({ name: clean(t.name, 64), docs: docsOf(t), type: typeName(t.type) })),
    pdas: (p.pdas ?? []).map((d) => ({ name: clean(d.name, 64), seeds: ((d.seeds as Node[]) ?? []).map(seedText) })),
    errors: (p.errors ?? []).map((e) => ({ code: Number(e.code), name: clean(e.name, 64), message: clean(e.message, 200) })),
  };
}
