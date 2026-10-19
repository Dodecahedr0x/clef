import type { RelationEdge } from '@clef/explain';
import { getProgramDerivedAddress, type Address } from '@solana/kit';
import { useEffect, useMemo, useState } from 'react';
import { Pubkey } from '../../../components';
import { editorFor, seedBytes, seedText, type SeedEditor } from './seed-codec';

const programOf = (e: RelationEdge) => e.derivedBy ?? e.to;

const editorTag = (e: SeedEditor) => (e.kind === 'number' ? `${e.format}${e.endian === 'be' ? ' BE' : ''}` : e.kind);

/**
 * The seeds the account was derived from, one input each (text, key, integer or hex). Editing any re-derives the
 * address, to explore the program's other PDAs.
 */
export function SeedPanel({ account, edges, label }: { account: string; edges: RelationEdge[]; label: (a: string) => string }) {
  // One block per distinct derivation (several instructions may check the same PDA).
  const derivations = [...new Map(
    edges
      .filter((e) => (e.kind === 'pda' || e.kind === 'ata') && e.from === account && e.seeds?.length && e.seeds.every((s) => s.hex !== undefined))
      .map((e) => [`${programOf(e)}|${e.seeds!.map((s) => s.hex).join('|')}`, e]),
  ).values()];
  if (!derivations.length) return null;
  return (
    <>
      {derivations.map((e) => (
        <Derivation key={`${account}|${programOf(e)}|${e.seeds!.map((s) => s.hex).join('|')}`} edge={e} account={account} label={label} />
      ))}
    </>
  );
}

type Derived = { address: Address; bump: number } | { error: string } | null;

function Derivation({ edge, account, label }: { edge: RelationEdge; account: string; label: (a: string) => string }) {
  const seeds = edge.seeds!;
  const editors = useMemo(() => seeds.map(editorFor), [seeds]);
  const initial = useMemo(() => seeds.map((s, i) => seedText(s, editors[i]!)), [seeds, editors]);
  const [texts, setTexts] = useState(initial);
  const parsed = texts.map((t, i) => seedBytes(t, editors[i]!));
  const [derived, setDerived] = useState<Derived>(null);
  const edited = texts.some((t, i) => t !== initial[i]);

  useEffect(() => {
    let live = true;
    const bytes = parsed.map((p) => ('bytes' in p ? p.bytes : null));
    if (bytes.some((b) => b === null)) {
      setDerived(null);
      return;
    }
    getProgramDerivedAddress({ programAddress: programOf(edge) as Address, seeds: bytes as Uint8Array[] }).then(
      ([address, bump]) => live && setDerived({ address, bump }),
      (e: unknown) => live && setDerived({ error: e instanceof Error && e.message ? e.message : 'Could not derive an address from these seeds' }),
    );
    return () => {
      live = false;
    };
  }, [texts.join('\u0000'), programOf(edge)]);

  const same = derived && 'address' in derived && derived.address === account;
  return (
    <section aria-label="Seeds" className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Seeds</span>
        <span className="min-w-0 truncate text-xs text-muted">
          derived by {label(programOf(edge))} <Pubkey value={programOf(edge)} />
        </span>
        {edited && (
          <button type="button" onClick={() => setTexts(initial)} className="ml-auto flex-none border-0 bg-transparent p-0 text-xs font-semibold text-info underline">
            Reset
          </button>
        )}
      </div>
      {seeds.map((s, i) => {
        const p = parsed[i]!;
        const id = `seed-${account}-${i}`;
        return (
          <div key={i} className="flex flex-col gap-1">
            <label htmlFor={id} className="flex items-baseline gap-2 text-xs">
              <span className="font-mono text-ink">{s.kind === 'const' ? 'constant' : s.display}</span>
              <span className="text-muted">
                {s.kind === 'const' ? '' : `${s.kind === 'arg' ? 'argument' : 'account'} · `}
                {editorTag(editors[i]!)}
              </span>
            </label>
            <input
              id={id}
              value={texts[i]}
              spellCheck={false}
              aria-invalid={'error' in p}
              onChange={(e) => setTexts(texts.map((t, j) => (j === i ? e.target.value : t)))}
              className={`h-8 w-full rounded-lg border bg-surface-2 px-2 font-mono text-xs text-ink outline-none focus:border-primary ${'error' in p ? 'border-danger-line' : 'border-line'}`}
            />
            {'error' in p && <span className="text-xs text-danger-text">{p.error}</span>}
          </div>
        );
      })}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-line-soft pt-2 text-xs" aria-live="polite">
        <span className="text-muted">Address</span>
        {derived === null ? (
          <span className="text-muted">—</span>
        ) : 'error' in derived ? (
          <span className="text-danger-text">{derived.error}</span>
        ) : (
          <>
            <Pubkey value={derived.address} className="text-ink" />
            <span className="text-muted">bump {derived.bump}</span>
            <span className={same ? 'text-ok' : 'text-warn'}>{same ? '✓ this account' : edited ? 'another account' : 'differs from this account'}</span>
          </>
        )}
      </div>
    </section>
  );
}
