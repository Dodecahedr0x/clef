import type { ReactNode } from 'react';
import { LOGO_KEY } from '../lib/logo';

export type IconName = 'back' | 'panel' | 'tab' | 'close' | 'settings' | 'send' | 'receive' | 'swap' | 'history' | 'eye' | 'eye-off' | 'copy' | 'share' | 'lock' | 'check'
  | 'info' | 'warn' | 'danger' | 'shield-check' | 'shield-x' | 'chevron-down' | 'chevron-right' | 'chevron-up' | 'plus' | 'refresh' | 'sliders' | 'filter'
  | 'instructions' | 'changes' | 'relations' | 'logs' | 'details' | 'camera' | 'usb' | 'qr' | 'key' | 'clef' | 'spinner';

const SHIELD = 'M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6z';

// Paths copied from docs/design/canvas/*.dc.html; check/usb/qr/key are drawn in the same 24px stroke style.
const ICONS: Record<IconName, { w: number; d: ReactNode }> = {
  back: { w: 2, d: <path d="m15 6-6 6 6 6" /> },
  close: { w: 2, d: <path d="M6 6l12 12M18 6 6 18" /> },
  settings: {
    w: 1.8,
    d: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
      </>
    ),
  },
  send: { w: 2, d: <path d="M7 17 17 7M8 7h9v9" /> },
  receive: { w: 2, d: <path d="M17 7 7 17M16 17H7V8" /> },
  swap: { w: 2, d: <path d="M4 8h13l-3-3M20 16H7l3 3" /> },
  history: { w: 2, d: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></> },
  eye: { w: 1.8, d: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></> },
  'eye-off': { w: 2, d: <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 22 12a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /> },
  copy: { w: 2, d: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></> },
  share: { w: 2, d: <path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /> },
  lock: { w: 2, d: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></> },
  check: { w: 2, d: <path d="m5 12.5 4.5 4.5L19 7.5" /> },
  info: { w: 2, d: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" /></> },
  warn: { w: 2, d: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></> },
  danger: { w: 2, d: <><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17v.01" /></> },
  'shield-check': { w: 2, d: <><path d={SHIELD} /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></> },
  'shield-x': { w: 2, d: <><path d={SHIELD} /><path d="m9.5 9.5 5 5M14.5 9.5l-5 5" /></> },
  'chevron-down': { w: 2, d: <path d="m6 9 6 6 6-6" /> },
  'chevron-right': { w: 2, d: <path d="m9 6 6 6-6 6" /> },
  'chevron-up': { w: 2, d: <path d="m6 15 6-6 6 6" /> },
  panel: { w: 2, d: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M14.5 4.5v15" /></> },
  tab: { w: 2, d: <><path d="M13 4.5h6.5V11" /><path d="m19.5 4.5-8 8" /><path d="M10 5.5H6A2.5 2.5 0 0 0 3.5 8v10A2.5 2.5 0 0 0 6 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-4" /></> },
  plus: { w: 2, d: <path d="M12 5v14M5 12h14" /> },
  refresh: { w: 2, d: <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /> },
  sliders: { w: 2, d: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></> },
  filter: { w: 2, d: <path d="M4 6h16M4 12h10M4 18h6" /> },
  instructions: { w: 1.8, d: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /> },
  changes: { w: 1.8, d: <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M12 7v6M9 10h6M9 16.5h6" /></> },
  relations: {
    w: 1.8,
    d: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8.5 6h7M7.3 8.2l3.5 7.6M16.7 8.2l-3.5 7.6" /></>,
  },
  logs: { w: 1.8, d: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m7 9 3 3-3 3M12.5 15h4.5" /></> },
  details: { w: 1.8, d: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.8v.01" /></> },
  camera: { w: 2, d: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" /> },
  usb: { w: 2, d: <><rect x="7" y="9" width="10" height="12" rx="2" /><path d="M9.5 9V3h5v6M11 5.5v1M13 5.5v1" /></> },
  qr: {
    w: 2,
    d: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2M20 14v.01M14 20h.01M17 17h3v3h-3z" /></>,
  },
  key: { w: 2, d: <><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.7-8.7M16 7l2.5 2.5M14 9l2 2" /></> },
  clef: { w: 1.8, d: <><path d="M3 7h18M3 12h18M3 17h18" strokeOpacity="0.35" /><circle cx="9" cy="12" r="3.2" /><path d="M12.2 12H20M17 12v3M20 12v2" /></> },
  spinner: { w: 2.4, d: <path d="M12 3a9 9 0 1 0 9 9" /> },
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const icon = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={icon.w}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={`${name === 'spinner' ? 'animate-spin ' : ''}${className ?? ''}`.trim() || undefined}
    >
      {icon.d}
    </svg>
  );
}

// staff: the Unlock hero, the mark sitting on five staff lines that span the container.
export function Logo({ size = 22, staff = false }: { size?: number; staff?: boolean }) {
  if (!staff) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={LOGO_KEY.strokeWidth} strokeLinecap="round" className="text-primary" role="img" aria-label="Clef">
        <path d="M3 7h18M3 12h18M3 17h18" strokeOpacity="0.35" />
        <circle {...LOGO_KEY.circle} />
        <path d={LOGO_KEY.shaft} />
      </svg>
    );
  }
  const gap = Math.round(size * 0.146);
  return (
    <div className="relative flex items-center justify-center" style={{ height: size * 2.7 }} role="img" aria-label="Clef">
      <div aria-hidden="true" className="absolute inset-x-0 flex flex-col" style={{ gap, top: '50%', transform: 'translateY(-50%)' }}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-px bg-line-soft" />)}
      </div>
      <svg className="relative text-primary" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" aria-hidden="true">
        <circle cx="8.5" cy="12" r="4.2" fill="var(--color-bg)" />
        <path d="M12.7 12H21M17.5 12v3.2M21 12v2.2" />
      </svg>
    </div>
  );
}
