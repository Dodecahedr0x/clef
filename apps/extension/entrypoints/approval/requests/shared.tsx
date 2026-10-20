import { INTERNAL_ORIGIN, type ApprovalDecision, type PhishingHit, type PublicAccount, type SignerInfo } from '@clef/wallet-core';
import { useState, type ReactNode } from 'react';
import { ApprovalHeader, Button, DecisionFooter } from '../../../components';
import type { FullState } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';

export function siteName(origin: string): string {
  if (origin === INTERNAL_ORIGIN) return 'Clef';
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export const findAccount = (state: FullState, address: string | null | undefined): PublicAccount | undefined =>
  address ? state.accounts.find((a) => a.address === address) : undefined;

export const accountName = (state: FullState, address: string): string => findAccount(state, address)?.label ?? shortAddress(address);

export function signerFor(a: PublicAccount): SignerInfo {
  if (a.kind === 'ledger' && a.path) return { kind: 'ledger', address: a.address, path: a.path };
  if (a.kind === 'keystone' && a.path && a.xfp) return { kind: 'keystone', address: a.address, path: a.path, xfp: a.xfp };
  return { kind: 'software' };
}

const TONES = [
  'bg-primary-tint text-primary',
  'bg-info-bg text-info',
  'bg-violet-bg text-violet',
  'bg-warn-bg text-warn',
  'bg-ok-tint text-ok',
];

function toneFor(text: string): string {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

export function SiteMark({ text, size, blocked, tone }: { text: string; size: 28 | 56; blocked?: boolean; tone?: string }) {
  const shape = size === 56 ? 'h-14 w-14 rounded-[14px] text-[20px]' : 'size-7 rounded-[7px] text-[13px]';
  const colors = blocked ? 'border border-line bg-surface-2 text-muted' : (tone ?? toneFor(text));
  return (
    <span aria-hidden="true" className={`flex flex-none items-center justify-center font-semibold ${shape} ${colors}`}>
      {blocked ? '?' : (text[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function Page({ banner, children }: { banner?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-screen w-full min-w-0 flex-col overflow-hidden bg-bg font-sans text-ink">
      {banner}
      {children}
    </div>
  );
}

/** The transaction approval's header line (`ApprovalHeader`), with a site or vault mark. */
export function Header({ mark, title, subtitle }: { mark: ReactNode; title: ReactNode; subtitle: ReactNode }) {
  return <ApprovalHeader mark={mark} title={title} subtitle={subtitle} />;
}

/** The transaction approval's decision buttons (`DecisionFooter`): the same styles, busy state and Escape to reject. */
export function Footer(p: Parameters<typeof DecisionFooter>[0]) {
  return (
    <footer className="mt-auto flex-none border-t border-line-soft">
      <DecisionFooter {...p} />
    </footer>
  );
}

export function SingleFooter({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <footer className="mt-auto flex-none border-t border-line-soft p-4">
      <Button variant="secondary" block onClick={onClick}>
        {label}
      </Button>
    </footer>
  );
}

export function CheckRow({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span aria-hidden="true" className={`font-semibold ${ok ? 'text-ok' : 'text-danger-text'}`}>
        {ok ? '✓' : '✕'}
      </span>
      <span>{children}</span>
    </div>
  );
}

export function Acknowledge({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-[10px] text-[14px] text-ink">
      <input type="checkbox" className="m-0 h-5 w-5 flex-none accent-danger" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function PhishingAck(p: { checked: boolean; onChange: (v: boolean) => void }) {
  return <Acknowledge {...p}>I understand this site is on a phishing list</Acknowledge>;
}

export function DangerBox({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <section role="alert" className="flex flex-col gap-[10px] rounded-[14px] border border-danger-line bg-danger-bg p-[14px]">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-danger px-2 py-0.5 text-[12px] font-semibold tracking-[0.04em] text-white">DANGER</span>
        <span className="text-[14px] font-semibold text-danger-ink-2">{title}</span>
      </div>
      {children && <p className="m-0 text-[14px] leading-normal text-danger-ink">{children}</p>}
    </section>
  );
}

export const CardLabel = ({ children }: { children: ReactNode }) => (
  <div className="border-b border-line-soft bg-surface-3 px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{children}</div>
);

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs an approval: hardware signatures (when `sign` is given) are forwarded in the decision. */
export function useApprove(onDecide: (d: ApprovalDecision) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (base: Extract<ApprovalDecision, { approved: true }>, sign?: () => Promise<Uint8Array[]>) => {
    setBusy(true);
    setError(null);
    try {
      const signatures = sign ? await sign() : undefined;
      onDecide(signatures ? { ...base, signatures } : base);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export const ErrorLine = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="m-0 px-1 text-[12px] text-danger-text">
      {error}
    </p>
  ) : null;

export type { PhishingHit };
