import type { AccountDiffView } from '@clef/explain';
import { useRef, useState } from 'react';
import { call } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';
import { displaySign } from './model';
import { useOnChain } from './source';

const LINE_TONE: Record<string, string> = { '-': 'bg-danger-bg text-danger-ink-2', '+': 'bg-ok-bg text-ok-ink', ' ': 'text-muted' };
const TAG_TONE: Record<AccountDiffView['tag'], string> = { new: 'bg-ok-bg text-ok-ink', closed: 'bg-danger-bg text-danger-ink-2', temp: 'bg-info-bg text-info-ink', modified: 'bg-surface-2 text-muted' };

export function diffCounts(diffs: AccountDiffView[]) {
  let adds = 0;
  let dels = 0;
  for (const d of diffs) {
    for (const l of [...d.lines, ...(d.undecoded?.lines ?? [])]) {
      if (l.sign === '+') adds++;
      if (l.sign === '-') dels++;
    }
  }
  return { adds, dels };
}

function DiffCard({ d }: { d: AccountDiffView }) {
  return (
    <article aria-label={d.title} className={`overflow-hidden rounded-xl bg-surface ${d.tag === 'temp' ? 'border border-dashed border-[#9CB4E8]' : 'border border-line'}`}>
      <div className="flex items-center gap-2 border-b border-line-soft bg-surface-3 px-3.5 py-2">
        <span className="text-xs font-semibold">{d.title}</span>
        <span className="font-mono text-xs text-muted">{shortAddress(d.address)}</span>
        <span className={`ml-auto rounded-[5px] px-1.5 text-xs ${TAG_TONE[d.tag]}`}>{d.type}</span>
      </div>
      {d.lines.map((l, i) => (
        <div key={i} className={`grid grid-cols-[18px_120px_minmax(0,1fr)_auto] gap-2 px-3.5 py-0.5 font-mono text-xs leading-[18px] ${LINE_TONE[l.sign]}`}>
          <span>{displaySign(l.sign)}</span>
          <span className="truncate">{l.key}</span>
          <span className="truncate">{l.value}</span>
          <span>{l.note ?? ''}</span>
        </div>
      ))}
    </article>
  );
}

function RawCard({ d, owner, network, onResimulate }: { d: AccountDiffView & { undecoded: NonNullable<AccountDiffView['undecoded']> }; owner: string | null; network: string; onResimulate: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const u = d.undecoded;

  const add = async (file: File | undefined) => {
    if (!file || !owner) return;
    try {
      await call({ type: 'idls:add', programId: owner, network, json: await file.text() });
      setStatus({ ok: true, text: 'IDL added. Re-simulate to decode this account.' });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <article aria-label={d.title} className="overflow-hidden rounded-xl border border-dashed border-warn bg-surface">
      <div className="flex items-center gap-2 border-b border-warn-line bg-warn-bg px-3.5 py-2">
        <span className="text-xs font-semibold">{d.title}</span>
        <span className="font-mono text-xs text-muted">{shortAddress(d.address)}</span>
        <span className="ml-auto rounded-[5px] bg-warn px-1.5 text-xs font-semibold text-white">Not decoded</span>
      </div>
      <div className="px-3.5 pt-2 pb-1 text-xs text-warn-ink">
        {d.type && `Owned by ${d.type} · `}
        {u.reason}, so Clef shows raw bytes.{d.lastChangedBy !== undefined && ` Changed in tx ${d.lastChangedBy + 1}.`}
      </div>
      {u.lines.map((l, i) => (
        <div key={i} className={`grid grid-cols-[18px_64px_minmax(0,1fr)] gap-2 px-3.5 py-0.5 font-mono text-xs leading-[18px] ${LINE_TONE[l.sign]}`}>
          <span>{displaySign(l.sign)}</span>
          <span>{l.offset}</span>
          <span className="break-all">{l.bytes}</span>
        </div>
      ))}
      <div className="flex items-center gap-2.5 border-t border-line-soft px-3.5 py-2 text-xs text-muted">
        <span>{u.summary}</span>
        {status?.ok ? (
          <button type="button" onClick={onResimulate} className="ml-auto h-8 rounded-lg border border-line-strong bg-surface px-3 text-xs font-semibold text-ink">
            Re-simulate
          </button>
        ) : (
          <button
            type="button"
            disabled={!owner}
            title={owner ? `Add an IDL for ${owner}` : 'Owner program unknown'}
            onClick={() => input.current?.click()}
            className="ml-auto h-8 rounded-lg border border-line-strong bg-surface px-3 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:text-faint"
          >
            Add IDL
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          aria-label={`IDL file for ${owner ?? d.address}`}
          className="hidden"
          onChange={(e) => void add(e.target.files?.[0])}
        />
      </div>
      {status && <div className={`px-3.5 pb-2 text-xs ${status.ok ? 'text-ok' : 'text-danger-text'}`}>{status.text}</div>}
    </article>
  );
}

export function StateChanges(p: {
  diffs: AccountDiffView[] | null;
  isAll: boolean;
  batchSize: number;
  ownerOf: (address: string) => string | null;
  network: string;
  onResimulate: () => void;
}) {
  const onChain = useOnChain();
  const { adds, dels } = diffCounts(p.diffs ?? []);
  return (
    <section id="exp-changes" aria-label="State changes" className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="m-0 flex-1 text-lg font-semibold">State changes</h2>
        {/* Unknown changes get no counts: "0 accounts" would read as "nothing changed". */}
        {p.diffs !== null && (
          <>
            <span className="font-mono text-xs">
              <span className="text-ok">+{adds}</span> <span className="text-danger-text">{'−'}{dels}</span>
            </span>
            <span className="text-xs text-muted">· {p.diffs.length} accounts</span>
          </>
        )}
      </div>
      {p.isAll && p.batchSize > 1 && (
        <p className="m-0 rounded-[10px] bg-info-bg px-3 py-2.5 text-xs leading-normal text-info-ink">
          Net effect of all {p.batchSize}, simulated back-to-back from the current state. Assumes no other transaction touches these accounts in between. Notes show which transaction last changed a value.
        </p>
      )}
      {p.diffs === null ? (
        onChain ? (
          <p className="m-0 rounded-xl border border-line bg-surface px-3 py-2.5 text-xs text-muted">Solana keeps balances for past transactions but not account data, so only balance changes are shown.</p>
        ) : (
          <p className="m-0 rounded-xl border border-warn-line bg-warn-bg px-3 py-2.5 text-xs text-warn-ink">No simulation result, so Clef cannot show what changes.</p>
        )
      ) : p.diffs.length === 0 ? (
        <p className="m-0 text-xs text-muted">No account changes.</p>
      ) : (
        p.diffs.map((d) =>
          d.undecoded ? (
            <RawCard key={d.address} d={d as AccountDiffView & { undecoded: NonNullable<AccountDiffView['undecoded']> }} owner={p.ownerOf(d.address)} network={p.network} onResimulate={p.onResimulate} />
          ) : (
            <DiffCard key={d.address} d={d} />
          ),
        )
      )}
    </section>
  );
}
