import type { BatchView, Warning } from '@clef/explain';
import { Amount, Avatar } from '../../../components';
import { direction, displayAmount } from './model';
import { AllClear, DangerCards, UNKNOWN_CHANGES, WarnCards } from './parts';
import { useOnChain } from './source';

const AVATAR_TONE = ['violet', 'info', 'ok', 'warn', 'primary'] as const;

/** Basic shows the combined view only, single transaction or batch. */
export function BasicBody({ view, warnings, danger }: { view: BatchView; warnings: Warning[]; danger: boolean }) {
  const c = view.combined;
  const onChain = useOnChain();
  const dangers = warnings.filter((w) => w.severity === 'danger');
  const others = warnings.filter((w) => w.severity !== 'danger');

  if (danger) {
    return (
      <div className="flex flex-col gap-3.5 px-4 pt-5">
        <section className="flex flex-col gap-1.5 px-1">
          <span className="text-xs text-muted">{onChain ? 'This transaction' : 'You are about to'}</span>
          <h1 className="m-0 text-2xl leading-[1.2] font-semibold tracking-[-0.02em]">{c.summary}</h1>
        </section>
        <DangerCards warnings={dangers} />
        <WarnCards warnings={others} />
        <section className="flex items-center rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs text-muted tabular-nums">
          <span>{onChain ? 'Balance changes' : 'Simulated balance changes'}</span>
          <span className="ml-auto text-ink">
            {c.balanceChanges === null
              ? 'unknown'
              : c.balanceChanges.length
                ? c.balanceChanges.map((b) => `${displayAmount(b.amount)} ${b.asset}`).join(' · ')
                : 'none now'}
            {c.fee && ` · fee ${c.fee}`}
          </span>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-5 pt-6">
      <section className="flex flex-col gap-2">
        <span className="text-xs text-muted">{onChain ? 'This transaction' : 'You are about to'}</span>
        <h1 className="m-0 text-[26px] leading-[1.2] font-semibold tracking-[-0.02em]">{c.summary}</h1>
        {view.steps.length > 1 && <span className="text-sm text-muted">{view.steps.length} transactions, signed together</span>}
      </section>

      <section aria-labelledby="basic-bc" className="overflow-hidden rounded-[14px] border border-line bg-surface">
        <div className="flex items-center border-b border-line-soft px-3.5 py-3">
          <h2 id="basic-bc" className="m-0 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
            Balance changes
          </h2>
          <span className="ml-auto text-xs text-muted">{c.balanceChanges === null ? (onChain ? 'Not recorded' : 'Not simulated') : onChain ? 'Recorded on chain' : 'Simulated just now'}</span>
        </div>
        {c.balanceChanges === null ? (
          <p className="m-0 px-3.5 py-3 text-sm text-warn-ink">{UNKNOWN_CHANGES}</p>
        ) : c.balanceChanges.length === 0 ? (
          <p className="m-0 px-3.5 py-3 text-sm text-muted">None of your balances change</p>
        ) : (
          c.balanceChanges.map((b, i) => (
            <div key={i} className={`flex items-center gap-3 px-3.5 py-3 ${i ? 'border-t border-line-soft' : ''}`}>
              <Avatar text={b.asset.slice(0, 1).toUpperCase()} tone={AVATAR_TONE[i % AVATAR_TONE.length]} size={32} />
              <span className="flex-1 text-sm">{b.asset}</span>
              <span className="text-sm font-semibold">
                <Amount direction={direction(b.amount)}>{`${displayAmount(b.amount)} ${b.asset}`}</Amount>
              </span>
            </div>
          ))
        )}
        <div className="flex items-center border-t border-line-soft px-3.5 py-2.5 text-xs text-muted tabular-nums">
          <span>Network fee</span>
          <span className="ml-auto">{c.fee ?? 'unknown'}</span>
        </div>
      </section>

      {others.length ? <WarnCards warnings={others} /> : <AllClear />}
    </div>
  );
}
