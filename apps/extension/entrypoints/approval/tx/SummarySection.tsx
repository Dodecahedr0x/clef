import type { ChangeView, TransferView } from '@clef/explain';
import { Pubkey } from '../../../components';
import { shortAddress } from '../../../lib/format';
import { direction, displayAmount } from './model';

const VERB: Record<TransferView['kind'], string> = { sol: 'sent', token: 'sent', create: 'funds new account', mint: 'minted', burn: 'burned' };

/** Who gains or loses what (per account), the fee, and every SOL and token transfer. */
export function SummarySection({
  changes,
  fee,
  transfers,
  transfersPartial,
  label,
  onChain,
}: {
  changes: ChangeView[] | null;
  fee: string | null;
  transfers: TransferView[] | null;
  transfersPartial: boolean;
  label: (address: string) => string | undefined;
  onChain: boolean;
}) {
  const owners = changes ? [...new Set(changes.map((c) => c.owner))] : [];
  const who = (a: string) => {
    const l = label(a);
    return l && l !== shortAddress(a) ? <>{l} <Pubkey value={a} className="text-muted" /></> : <Pubkey value={a} />;
  };
  return (
    <section id="exp-summary" aria-label="Summary" className="flex scroll-mt-4 flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold">Summary</h2>
      <div className="overflow-hidden rounded-xl border border-line bg-surface text-xs">
        <div className="border-b border-line-soft bg-surface-2 px-3.5 py-1.5 font-semibold tracking-[0.06em] text-muted uppercase">
          {onChain ? 'Balance changes' : 'Simulated balance changes'}
        </div>
        {changes === null ? (
          <p className="m-0 px-3.5 py-2 text-warn">Balance changes unknown</p>
        ) : owners.length === 0 ? (
          <p className="m-0 px-3.5 py-2 text-muted">No balance changes</p>
        ) : (
          <table className="w-full border-collapse tabular-nums">
            <tbody>
              {owners.map((o) => (
                <tr key={o} className="border-t border-line-soft first:border-t-0">
                  <td className="min-w-0 px-3.5 py-1.5 align-top [overflow-wrap:anywhere]">{who(o)}</td>
                  <td className="px-3.5 py-1.5 text-right align-top">
                    {changes
                      .filter((c) => c.owner === o)
                      .map((c, i) => (
                        <div key={i} className={direction(c.amount) === 'out' ? 'text-danger-text' : direction(c.amount) === 'in' ? 'text-ok' : 'text-muted'}>
                          {displayAmount(c.amount)} {c.asset}
                        </div>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {fee && (
          <div className="flex border-t border-line-soft px-3.5 py-1.5 text-muted">
            <span>Network fee</span>
            <span className="ml-auto tabular-nums">{fee}</span>
          </div>
        )}
      </div>
      {transfers !== null && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface text-xs">
          <div className="border-b border-line-soft bg-surface-2 px-3.5 py-1.5 font-semibold tracking-[0.06em] text-muted uppercase">SOL and token transfers</div>
          {transfers.length === 0 ? (
            <p className="m-0 px-3.5 py-2 text-muted">None</p>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {transfers.map((t, i) => (
                  <tr key={i} className="border-t border-line-soft first:border-t-0 align-top">
                    <td className="px-3.5 py-1.5 font-semibold whitespace-nowrap tabular-nums">{t.amount}</td>
                    <td className="py-1.5 pr-3.5 [overflow-wrap:anywhere]">
                      {who(t.from)} <span className="text-muted">{VERB[t.kind]} →</span> {who(t.to)}
                      <span className="text-muted">
                        {' '}
                        · #{t.instructionIndex + 1}
                        {t.inner ? ' via a called program' : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {transfersPartial && <p className="m-0 border-t border-line-soft px-3.5 py-1.5 text-muted">The RPC didn't report what called programs moved: only the instructions' own transfers are listed.</p>}
        </div>
      )}
    </section>
  );
}
