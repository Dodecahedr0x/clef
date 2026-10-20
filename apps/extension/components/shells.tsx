import type { DetailLevel } from '@clef/explain';
import type { ReactNode } from 'react';
import { Button, IconButton } from './buttons';
import { Segmented } from './controls';
import { Icon, Logo } from './icons';

export function PopupScreen({
  title,
  onBack,
  onClose,
  right,
  children,
  footer,
  scroll = true,
}: {
  title?: ReactNode;
  onBack?: () => void;
  onClose?: () => void;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
}) {
  const header = title !== undefined || onBack || onClose || right;
  return (
    <div className="flex h-(--popup-h) w-(--popup-w) flex-col overflow-hidden bg-bg font-sans text-ink">
      {header && (
        <header className={`flex h-14 flex-none items-center gap-1 pr-3 ${onBack || onClose ? 'pl-1.5' : 'pl-4'} ${title !== undefined ? 'border-b border-line-soft' : ''}`}>
          {onBack && <IconButton label="Back" icon="back" onClick={onBack} className="text-ink" />}
          {onClose && !onBack && <IconButton label="Close" icon="close" onClick={onClose} className="text-ink" />}
          {title !== undefined && <h1 className="m-0 truncate text-[18px] font-semibold">{title}</h1>}
          {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </header>
      )}
      <main className={`flex min-h-0 flex-1 flex-col ${scroll ? 'overflow-y-auto' : 'overflow-hidden'}`}>{children}</main>
      {footer && <footer className="flex-none px-4 pb-4 pt-3">{footer}</footer>}
    </div>
  );
}

export const INTERNAL_SITE_PREFIX = 'clef://';

export function siteName(origin: string): string {
  if (origin.startsWith(INTERNAL_SITE_PREFIX)) return 'Clef';
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function ApprovalFrame({
  site,
  title,
  subtitle,
  headerRight,
  banner,
  children,
  footer,
  width = 400,
  onBack,
}: {
  site: { origin: string; icon?: string };
  /** Replaces the site name as the header title. */
  title?: ReactNode;
  subtitle: ReactNode;
  headerRight?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  /** 'fill' sizes to the container (a popup or side-panel screen) instead of the approval window. */
  width?: 400 | 760 | 'fill';
  onBack?: () => void;
}) {
  const name = siteName(site.origin);
  const internal = site.origin.startsWith(INTERNAL_SITE_PREFIX);
  return (
    <div className={`flex ${width === 'fill' ? 'h-full w-full' : 'h-screen'} flex-col overflow-hidden bg-bg font-sans text-ink`} style={width === 'fill' ? undefined : { width }}>
      {banner}
      <header className={`flex flex-none items-center gap-2 border-b border-line-soft py-1.5 ${onBack ? 'pl-1 pr-3' : 'px-3'}`}>
        {onBack && <IconButton label="Back" icon="back" onClick={onBack} className="-mr-1 text-ink" />}
        <span className="flex size-7 flex-none items-center justify-center overflow-hidden rounded-[7px] border border-line bg-surface-2 text-[13px] font-semibold text-primary">
          {internal ? <Logo size={20} /> : site.icon ? <img src={site.icon} alt="" className="size-full object-cover" /> : <span aria-hidden="true">{name.charAt(0).toUpperCase() || '?'}</span>}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-tight font-semibold">{title ?? name}</span>
          <span className="truncate text-[11px] leading-tight text-muted">{subtitle}</span>
        </div>
        {headerRight && <div className="flex flex-none items-center gap-2">{headerRight}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      <footer className="flex-none border-t border-line-soft">{footer}</footer>
    </div>
  );
}

export function DetailLevelSwitch({ value, onChange, compact = false }: { value: DetailLevel; onChange: (v: DetailLevel) => void; compact?: boolean }) {
  return (
    <Segmented<DetailLevel>
      ariaLabel="Detail level"
      bordered
      value={value}
      onChange={onChange}
      options={[
        { value: 'basic', label: 'Basic' },
        { value: 'intermediate', label: compact ? 'Inter.' : 'Intermediate', ariaLabel: compact ? 'Intermediate' : undefined },
        { value: 'expert', label: 'Expert' },
      ]}
    />
  );
}

export function NetworkSwitch({ value, onChange, compact = false }: { value: 'mainnet' | 'devnet'; onChange: (v: 'mainnet' | 'devnet') => void; compact?: boolean }) {
  const dot = (c: string) => <span aria-hidden="true" className={`flex-none rounded-full ${compact ? 'size-1.5' : 'size-[7px]'} ${c}`} />;
  return (
    <Segmented<'mainnet' | 'devnet'>
      ariaLabel="Network"
      value={value}
      onChange={onChange}
      options={[
        { value: 'mainnet', label: <>{dot('bg-ok')}{compact ? 'Main' : 'Mainnet'}</>, ariaLabel: 'Mainnet' },
        { value: 'devnet', label: <>{dot('bg-warn')}{compact ? 'Dev' : 'Devnet'}</>, ariaLabel: 'Devnet' },
      ]}
    />
  );
}

/**
 * Marks a test network on every screen, so test funds never look real: its name hangs from the top edge, and the
 * edge itself turns amber unless the user turned the tint off. Nothing on mainnet.
 */
export function NetworkEdge({ cluster, tint }: { cluster: 'mainnet' | 'devnet' | 'localnet'; tint: boolean }) {
  if (cluster === 'mainnet') return null;
  const name = cluster === 'devnet' ? 'Devnet' : 'Localnet';
  return (
    <div data-testid="network-edge" className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center">
      {tint && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-warn" />}
      <span role="note" aria-label={`Test network: ${name}`} className="relative rounded-b-[6px] bg-warn px-1.5 text-[10px] leading-[12px] font-semibold tracking-[0.06em] text-white uppercase">
        {name}
      </span>
    </div>
  );
}

/** The network a request is for, read-only: an approval never changes networks under the user. */
export function NetworkChip({ cluster }: { cluster: 'mainnet' | 'devnet' | 'localnet' }) {
  const name = cluster === 'mainnet' ? 'Mainnet' : cluster === 'devnet' ? 'Devnet' : 'Localnet';
  return (
    <span role="img" aria-label={`Network: ${name}`} className="inline-flex h-7 flex-none items-center gap-1.5 rounded-full border border-line bg-surface px-2 text-[12px] text-ink">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${cluster === 'mainnet' ? 'bg-ok' : 'bg-warn'}`} />
      <span aria-hidden="true">{name}</span>
    </span>
  );
}

// dangerPrimary: the safe choice (Reject) takes the primary style and approval is the secondary one.
export function DecisionFooter({
  onReject,
  onApprove,
  approveLabel,
  rejectLabel = 'Reject',
  approveDisabled = false,
  busy = false,
  extra,
  dangerPrimary = false,
}: {
  onReject: () => void;
  onApprove: () => void;
  approveLabel: string;
  rejectLabel?: string;
  approveDisabled?: boolean;
  busy?: boolean;
  extra?: ReactNode;
  dangerPrimary?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {extra}
      <div className="grid grid-cols-2 gap-2.5">
        <Button variant={dangerPrimary ? 'primary' : 'secondary'} onClick={onReject} disabled={busy}>
          {rejectLabel}
        </Button>
        <Button variant={dangerPrimary ? 'secondary' : 'primary'} onClick={onApprove} disabled={approveDisabled || busy} aria-busy={busy || undefined}>
          {busy && <Icon name="spinner" size={16} />}
          {approveLabel}
        </Button>
      </div>
    </div>
  );
}
