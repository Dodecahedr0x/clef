import type { ExpertInstructionView, ExpertView } from '@clef/explain';
import { useState } from 'react';
import { shortAddress } from '../../../lib/format';
import { Pubkey } from '../../../components';

type Step = { index: number; title: string; view: ExpertView };
type Pick = { step: number; ix: number };

function argSummary(ix: ExpertInstructionView): string {
  const first = Object.entries(ix.args)[0];
  if (ix.noEffect) return 'no effect in v1';
  return first ? `${first[0]} ${first[1]}` : '';
}

function largest(steps: Step[]): Pick | null {
  let best: (Pick & { n: number }) | null = null;
  for (const s of steps) for (const ix of s.view.instructions) if (!best || ix.accounts.length > best.n) best = { step: s.index, ix: ix.index, n: ix.accounts.length };
  return best && { step: best.step, ix: best.ix };
}

function chunks(hex: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < hex.length; i += 16) out.push(hex.slice(i, i + 16));
  return out;
}

function Detail({ step, ix }: { step: Step; ix: ExpertInstructionView }) {
  const name = `Tx ${step.index + 1} · ${ix.program} · ${ix.name} · accounts`;
  const pdas = step.view.relations.filter((r) => r.kind === 'pda' && (r.instructionIndex === undefined || r.instructionIndex === ix.index) && ix.accounts.some((a) => a.address === r.from));
  const hex = ix.dataHex.replace(/\s+/g, '');
  const [disc, ...rest] = chunks(hex);
  return (
    <>
      <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{name}</span>
      <table aria-label={name} className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-2xl border border-line bg-surface font-mono text-xs">
        <colgroup>
          <col className="w-[38px]" />
          <col className="w-[120px]" />
          <col className="w-[50px]" />
          <col />
          <col className="w-[110px]" />
        </colgroup>
        <thead>
          <tr className="text-left font-sans text-muted">
            {['#', 'Address', 'Flags', 'IDL name', 'Source'].map((h) => (
              <th key={h} className="border-b border-line-soft px-2.5 py-2 font-normal first:pl-3.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ix.accounts.map((a, i) => (
            <tr key={i} className={a.signer ? 'bg-surface-3' : ''}>
              <td className="px-2.5 py-[7px] pl-3.5 text-muted">{i}</td>
              <td className="truncate px-2.5 py-[7px]">
                <Pubkey value={a.address} />
              </td>
              <td className="px-2.5 py-[7px] text-warn">{[a.signer && 'S', a.writable && 'W'].filter(Boolean).join(' ')}</td>
              <td className="truncate px-2.5 py-[7px]">{a.name}</td>
              <td className={`truncate px-2.5 py-[7px] ${a.lookupTable ? 'text-info' : 'text-muted'}`}>{a.lookupTable ? <Pubkey value={a.lookupTable} prefix="ALT " /> : 'msg'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-3">
        {pdas.map((r, i) => {
          const at = ix.accounts.findIndex((a) => a.address === r.from);
          return (
            <div key={i} className="rounded-2xl border border-line bg-surface px-3.5 py-3 font-mono text-xs leading-[1.7]">
              <div className="font-sans text-muted">PDA · {r.label}</div>
              <div>
                seeds = [
                {(r.seeds ?? []).map((s, j) => (
                  <span key={j}>
                    {j > 0 && ', '}
                    <span className="text-warn-ink">{s.display}</span>
                  </span>
                ))}
                ]
              </div>
              <div>
                {r.bump !== undefined && `bump ${r.bump} `}
                <span className={r.status === 'verified' ? 'text-ok' : r.status === 'mismatch' ? 'text-danger-text' : 'text-warn'}>
                  {r.status === 'verified' ? `✓ matches #${at}` : r.status === 'mismatch' ? `✗ does not match #${at}` : '? not checked'}
                </span>
              </div>
            </div>
          );
        })}
        <div className="col-span-1 rounded-2xl border border-line bg-surface px-3.5 py-3 font-mono text-xs leading-[1.7] break-all">
          <div className="font-sans text-muted">Instruction data · {hex.length / 2} bytes</div>
          {disc !== undefined && <span className={ix.idl ? 'font-semibold text-primary' : ''}>{disc}</span>} {rest.join(' ')}
        </div>
      </div>
    </>
  );
}

export function ExpertInstructions({ steps }: { steps: Step[] }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const current = pick && steps.some((s) => s.index === pick.step) ? pick : largest(steps);
  const step = current && steps.find((s) => s.index === current.step);
  const ix = step && step.view.instructions.find((x) => x.index === current.ix);
  return (
    <section id="exp-instr" aria-label="Instructions" className="flex scroll-mt-4 flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold">Instructions</h2>
      {steps.map((s) => (
        <div key={s.index} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line-soft bg-surface-3 px-3.5 py-2 text-xs font-semibold text-muted">
            Transaction {s.index + 1} · {s.title}
          </div>
          {s.view.instructions.map((x, i) => {
            const on = current?.step === s.index && current.ix === x.index;
            return (
              <button
                key={x.index}
                type="button"
                aria-expanded={on}
                onClick={() => setPick({ step: s.index, ix: x.index })}
                className={`flex min-h-10 w-full items-center gap-2.5 px-3.5 text-left text-sm ${on ? 'bg-surface-3' : 'bg-transparent'} ${i ? 'border-t border-line-soft' : ''}`}
              >
                <span className="w-4 font-mono text-xs text-muted">{x.index + 1}</span>
                <span className={x.noEffect ? 'text-faint' : ''}>
                  <span className="text-muted">{x.program} ·</span> {x.name}
                </span>
                <span className="ml-auto truncate text-xs text-muted">{argSummary(x)}</span>
              </button>
            );
          })}
        </div>
      ))}
      {step && ix && <Detail step={step} ix={ix} />}
    </section>
  );
}
