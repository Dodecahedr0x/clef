import { defaultExplainContext, explain, viewFor, type IntermediateView, type Warning } from '@clef/explain';
import { KitChainReader } from '@clef/rpc';
import type { WalletState } from '@clef/wallet-core';
import type { Address } from '@solana/kit';
import { useEffect, useState } from 'react';
import { shortAddress } from '../../lib/api';

export type TxResult = { status: 'loading' } | { status: 'ok'; view: IntermediateView } | { status: 'failed' };

const SEVERITY_ORDER = { danger: 0, warn: 1, info: 2 } as const;
const SEVERITY_STYLE = {
  danger: 'border-red-500 bg-red-950 text-red-200',
  warn: 'border-amber-500 bg-amber-950 text-amber-100',
  info: 'border-gray-600 bg-gray-900 text-gray-300',
} as const;

export const hasDanger = (r: TxResult) => r.status === 'failed' || (r.status === 'ok' && r.view.warnings.some((w) => w.severity === 'danger'));

/** Explains each transaction with the M1 engine. Any failure is reported as a danger (fail closed). */
export function useExplanations(transactions: Uint8Array[], state: WalletState): TxResult[] {
  const [results, setResults] = useState<TxResult[]>(() => transactions.map(() => ({ status: 'loading' })));
  useEffect(() => {
    let cancelled = false;
    const reader = new KitChainReader(state.settings.rpcUrl);
    const me = state.accounts.map((a) => a.address as Address);
    const labels = Object.fromEntries(state.accounts.map((a) => [a.address, a.label]));
    transactions.forEach((wire, i) => {
      explain({ wire }, defaultExplainContext(reader, me, labels))
        .then((ex) => ({ status: 'ok', view: viewFor(ex, 'intermediate') }) as const)
        .catch(() => ({ status: 'failed' }) as const)
        .then((result) => {
          if (!cancelled) setResults((prev) => prev.map((r, j) => (j === i ? result : r)));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [transactions, state]);
  return results;
}

function Warnings({ warnings }: { warnings: Warning[] }) {
  const sorted = [...warnings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return (
    <ul className="space-y-2">
      {sorted.map((w, i) => (
        <li key={i} className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY_STYLE[w.severity]}`}>
          {w.severity === 'danger' && <strong className="mr-1">DANGER</strong>}
          {w.message}
        </li>
      ))}
    </ul>
  );
}

export function TxReview({ index, total, result }: { index: number; total: number; result: TxResult }) {
  const [details, setDetails] = useState(false);
  return (
    <section className="space-y-3 rounded-xl bg-gray-900 p-3">
      {total > 1 && <div className="text-xs text-gray-500">Transaction {index + 1} of {total}</div>}
      {result.status === 'loading' && <p className="text-sm text-gray-400">Explaining...</p>}
      {result.status === 'failed' && (
        <p className="rounded-lg border border-red-500 bg-red-950 px-3 py-2 text-sm text-red-200">
          <strong className="mr-1">DANGER</strong>Clef could not explain this transaction.
        </p>
      )}
      {result.status === 'ok' && (
        <>
          <p className="text-base font-medium">{result.view.summary}</p>
          <Warnings warnings={result.view.warnings} />
          <div className="text-sm">
            <div className="mb-1 text-gray-400">Your balance changes</div>
            {result.view.balanceChanges === null ? (
              <p className="text-amber-300">Unknown: simulation unavailable</p>
            ) : result.view.balanceChanges.length === 0 ? (
              <p className="text-gray-500">None</p>
            ) : (
              <ul className="font-mono">
                {result.view.balanceChanges.map((c, i) => (
                  <li key={i} className={c.amount.startsWith('-') ? 'text-red-300' : 'text-emerald-300'}>
                    {c.amount} {c.asset}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {result.view.fee && <p className="text-sm text-amber-300">Network fee: {result.view.fee}</p>}
          <button className="text-xs text-violet-300" onClick={() => setDetails((d) => !d)}>
            {details ? 'Hide details' : 'Show details'}
          </button>
          {details && (
            <ol className="space-y-2 text-xs">
              {result.view.instructions.map((ix) => (
                <li key={ix.index} className="rounded bg-gray-950 p-2">
                  <div className="font-medium">
                    #{ix.index + 1} {ix.program} - {ix.name}
                    {ix.trust && <span className="ml-1 text-gray-500">[{ix.trust}]</span>}
                  </div>
                  {Object.entries(ix.args).map(([k, v]) => (
                    <div key={k} className="text-gray-400">
                      {k}: <span className="font-mono">{v}</span>
                    </div>
                  ))}
                  {ix.accounts.map((a, i) => (
                    <div key={i} className="text-gray-400">
                      {a.name}: {a.label ?? ''} <span className="font-mono">{shortAddress(a.address)}</span> {a.badges.join(' ')}
                    </div>
                  ))}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
