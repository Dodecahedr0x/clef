import { cloneElement, useId, useState, type ReactElement, type ReactNode, type SyntheticEvent } from 'react';
import { useCopy } from '../lib/a11y';
import { shortAddress } from '../lib/format';
import { Icon, type IconName } from './icons';
import { TONE, type Tone } from './tone';

export function Card({ children, tone = 'neutral', dashed = false, padded = false, className = '' }: { children: ReactNode; tone?: Tone; dashed?: boolean; padded?: boolean; className?: string }) {
  return <section className={`overflow-hidden rounded-[12px] border ${dashed ? 'border-dashed' : ''} ${TONE[tone].card} ${padded ? 'p-3.5' : ''} ${className}`}>{children}</section>;
}

export function CardHeader({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-line-soft bg-surface-3 px-3.5 py-2 text-[12px]">
      <span className="font-semibold">{title}</span>
      {right && <span className="ml-auto flex items-center gap-2 text-muted">{right}</span>}
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mx-1 flex items-center gap-2">
      <h2 className="m-0 flex-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{children}</h2>
      {right && <span className="text-[12px] text-muted">{right}</span>}
    </div>
  );
}

export function ListGroup({ children }: { children: ReactNode }) {
  return <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line bg-surface p-0 [&>li+li]:border-t [&>li+li]:border-line-soft">{children}</ul>;
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onClick,
  chevron = false,
  selected = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  selected?: boolean;
}) {
  const body = (
    <>
      {leading && <span className="flex flex-none items-center">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-[14px] ${subtitle ? 'font-medium' : ''}`}>{title}</span>
        {subtitle && <span className="truncate text-[12px] text-muted">{subtitle}</span>}
      </span>
      {trailing && <span className="flex flex-none flex-col items-end text-[12px] text-muted tabular-nums">{trailing}</span>}
      {chevron && <Icon name="chevron-right" size={14} className="flex-none text-muted" />}
    </>
  );
  const cls = `flex w-full items-center gap-2.5 px-3 text-left text-ink ${subtitle ? 'min-h-[50px] py-1.5' : 'min-h-11'} ${selected ? 'bg-primary-bg' : 'bg-transparent'}`;
  return (
    <li className="list-none">
      {onClick ? (
        <button type="button" onClick={onClick} aria-current={selected ? 'true' : undefined} className={`${cls} border-0 hover:bg-surface-3`}>
          {body}
        </button>
      ) : (
        <div className={cls} aria-current={selected ? 'true' : undefined}>{body}</div>
      )}
    </li>
  );
}

export function Pill({ tone = 'neutral', solid = false, children }: { tone?: Tone; solid?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] ${solid ? `${TONE[tone].solid} font-semibold tracking-[0.04em]` : TONE[tone].soft}`}>
      {children}
    </span>
  );
}

const ALERT: Record<'info' | 'ok' | 'warn' | 'danger', { box: string; icon: IconName; iconColor: string; title: string; tone: Tone }> = {
  info: { box: 'bg-info-bg border-info-bg text-info-ink', icon: 'info', iconColor: 'text-info', title: 'text-info-ink', tone: 'info' },
  ok: { box: 'bg-ok-bg border-ok-line text-ok-ink-2', icon: 'shield-check', iconColor: 'text-ok', title: 'text-ok-ink', tone: 'ok' },
  warn: { box: 'bg-warn-bg border-warn-line text-warn-ink', icon: 'warn', iconColor: 'text-warn', title: 'text-warn-ink', tone: 'warn' },
  danger: { box: 'bg-danger-bg border-danger-line text-danger-ink', icon: 'danger', iconColor: 'text-danger', title: 'text-danger-ink-2', tone: 'danger' },
};

export function Alert({ severity, title, children, label }: { severity: 'info' | 'ok' | 'warn' | 'danger'; title?: ReactNode; children: ReactNode; label?: string }) {
  const a = ALERT[severity];
  if (label) {
    return (
      <div role={severity === 'danger' ? 'alert' : 'status'} className={`flex flex-col gap-2.5 rounded-[14px] border p-3.5 text-[14px] leading-normal ${a.box}`}>
        <div className="flex items-center gap-2">
          <Pill tone={a.tone} solid>{label}</Pill>
          {title && <span className={`font-semibold ${a.title}`}>{title}</span>}
        </div>
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div role={severity === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-[12px] border px-3 py-2.5 text-[12px] leading-[1.45] ${a.box}`}>
      <Icon name={a.icon} size={16} className={`mt-px flex-none ${a.iconColor}`} />
      <div className="flex min-w-0 flex-col gap-0.5">
        {title && <span className={`text-[14px] font-semibold ${a.title}`}>{title}</span>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ text, tone = 'neutral', size = 34, square = false, src }: { text: string; tone?: Tone; size?: number; square?: boolean; src?: string }) {
  const shape = square ? 'rounded-[8px]' : 'rounded-full';
  if (src) return <img src={src} alt="" width={size} height={size} className={`flex-none object-cover ${shape}`} style={{ width: size, height: size }} />;
  return (
    <span
      aria-hidden="true"
      className={`flex flex-none items-center justify-center font-semibold ${shape} ${TONE[tone].avatar}`}
      style={{ width: size, height: size, fontSize: size >= 32 && square ? 14 : 12 }}
    >
      {text.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/**
 * A public key (or signature) shown short, `Abcd…wxyz`, that copies the full value on click. Works inside
 * clickable rows: the click is not passed on.
 */
export function Pubkey({ value, className = '', prefix }: { value: string; className?: string; prefix?: string }) {
  const clip = useCopy(1200);
  const copied = clip.copied;
  const copy = (e: SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    clip.copy(value);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      title={`${value} · click to copy`}
      aria-label={`Copy ${value}`}
      onClick={copy}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') copy(e);
      }}
      className={`inline-flex cursor-copy items-center gap-1 rounded-[4px] font-mono hover:underline focus-visible:outline-2 focus-visible:outline-primary ${className}`}
    >
      {prefix}
      {shortAddress(value)}
      {copied && <Icon name="check" size={12} className="text-ok" />}
    </span>
  );
}

export function AddressText({ address, mode = 'short', className = '' }: { address: string; mode?: 'short' | 'full' | 'groups'; className?: string }) {
  if (mode === 'short') return <Pubkey value={address} className={className} />;
  if (mode === 'full') return <span className={`break-all font-mono ${className}`}>{address}</span>;
  const groups = address.match(/.{1,4}/g) ?? [];
  return (
    <span className={`font-mono [word-spacing:0.2em] ${className}`} aria-label={address}>
      {groups.map((g, i) => {
        const edge = i === 0 || i === groups.length - 1;
        return (
          <span key={i} aria-hidden="true">
            {i > 0 && ' '}
            {edge ? <strong className="font-semibold">{g}</strong> : g}
          </span>
        );
      })}
    </span>
  );
}

export function Amount({ children, direction = 'neutral' }: { children: string; direction?: 'in' | 'out' | 'neutral' }) {
  const color = direction === 'in' ? 'text-ok' : direction === 'out' ? 'text-danger-text' : '';
  return <span className={`tabular-nums ${color}`}>{children}</span>;
}

// current is 1-based: steps 1..current are filled.
export function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div role="img" aria-label={`Step ${current} of ${total}`} className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1 w-6 rounded-[2px] ${i < current ? 'bg-primary' : 'bg-line-strong'}`} />
      ))}
    </div>
  );
}

export function Tooltip({ tip, children, side = 'right' }: { tip: string; children: ReactElement<{ 'aria-describedby'?: string }>; side?: 'right' | 'top' | 'bottom' }) {
  const id = useId();
  const pos = {
    right: 'left-[calc(100%+10px)] top-1/2 -translate-y-1/2',
    top: 'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2',
    bottom: 'top-[calc(100%+8px)] left-1/2 -translate-x-1/2',
  }[side];
  const [dismissed, setDismissed] = useState(false);
  return (
    <span
      className="clef-tip relative inline-flex"
      data-dismissed={dismissed || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !dismissed) {
          setDismissed(true);
          e.stopPropagation();
        }
      }}
      onPointerLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span role="tooltip" id={id} className={`absolute z-10 whitespace-nowrap rounded-[7px] bg-ink px-[9px] py-[5px] text-[12px] font-medium text-white transition-opacity ${pos}`}>
        {tip}
      </span>
    </span>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span role="status" aria-label="Loading" className="inline-flex text-primary">
      <Icon name="spinner" size={size} />
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="m-0 text-[14px] font-semibold">{title}</p>
      {body && <div className="text-[12px] leading-normal text-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
