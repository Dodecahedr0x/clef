import { DEFAULT_RPC, type CustomRpc, type Settings } from '@clef/wallet-core';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../../components';
import { call } from '../../../lib/api';
import { useNav } from '../../../lib/nav';
import { clusterOf, networkLabel } from '../../../lib/network';
import { rpcHost } from './Settings';

const BUILT_IN = [
  { value: 'mainnet', label: 'Mainnet' },
  { value: 'devnet', label: 'Devnet' },
  { value: 'localnet', label: 'Localnet' },
] as const;

const CLUSTER = { mainnet: 'Mainnet', devnet: 'Devnet' } as const;

/** Host only, never the path or query where providers put the API key; a repeated host is numbered. */
export function customRpcLabels(rpcs: CustomRpc[]): string[] {
  const seen = new Map<string, number>();
  return rpcs.map((r) => {
    const host = rpcHost(r.url);
    const n = (seen.get(host) ?? 0) + 1;
    seen.set(host, n);
    return `${host}${n > 1 ? ` (${n})` : ''} · ${CLUSTER[r.cluster]}`;
  });
}

export const pickerValue = (s: Settings) => (s.network === 'custom' ? `custom:${s.rpcUrl}` : s.network);

export function patchFor(value: string, s: Settings): Partial<Settings> | null {
  if (value === 'mainnet' || value === 'devnet' || value === 'localnet') return { network: value, rpcUrl: DEFAULT_RPC[value] };
  const rpc = (s.customRpcs ?? []).find((r) => `custom:${r.url}` === value);
  return rpc ? { network: 'custom', rpcUrl: rpc.url, customCluster: rpc.cluster } : null;
}

const LIST_W = 256;

type Item = { value: string; label: string; detail: string; live: boolean };

function items(s: Settings): Item[] {
  const customs = s.customRpcs ?? [];
  const labels = customRpcLabels(customs);
  return [
    ...BUILT_IN.map((o) => ({ value: o.value, label: o.label, detail: rpcHost(s.network === o.value ? s.rpcUrl : DEFAULT_RPC[o.value]), live: o.value === 'mainnet' })),
    ...customs.map((r, i) => ({ value: `custom:${r.url}`, label: labels[i]!.replace(/ · (Mainnet|Devnet)$/, ''), detail: CLUSTER[r.cluster], live: r.cluster === 'mainnet' })),
  ];
}

/**
 * The network chip: opens a list of the built-in networks and every saved custom RPC. A listbox with the keyboard
 * of one (arrows, Home/End, Enter, Escape), its focus kept on the list and the active row tracked with
 * aria-activedescendant.
 */
export function NetworkPicker({ settings, compact = false, align = 'start' }: { settings: Settings; compact?: boolean; align?: 'start' | 'end' }) {
  const nav = useNav();
  const id = useId();
  const [open, setOpen] = useState(false);
  const list = items(settings);
  const current = pickerValue(settings);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: LIST_W });
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const customs = list.length - BUILT_IN.length;

  const show = () => {
    // Fixed, kept 8px inside the window: the chip sits at either edge, and no parent clips the list.
    const b = button.current!.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const width = Math.min(LIST_W, vw - 16);
    const left = Math.min(Math.max(8, align === 'end' ? b.right - width : b.left), vw - width - 8);
    setPos({ top: b.bottom + 6, left, width });
    setActive(Math.max(0, list.findIndex((i) => i.value === current)));
    setOpen(true);
  };
  const hide = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const pick = (value: string) => {
    hide();
    if (value === current) return;
    const patch = patchFor(value, settings);
    if (patch) void call({ type: 'settings:update', patch });
  };

  useEffect(() => {
    if (!open) return;
    listbox.current?.focus();
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) hide(false);
    };
    // Fixed in place: anything moving the chip (a scroll, a resize) closes the list rather than leaving it behind.
    const moved = (e: Event) => {
      if (!(e.target instanceof Node && box.current?.contains(e.target))) hide(false);
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', moved);
    };
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);

  const onKey = (e: React.KeyboardEvent) => {
    const last = list.length - 1;
    const move: Record<string, number> = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };
    if (e.key in move) setActive(move[e.key]!);
    else if (e.key === 'Enter' || e.key === ' ') pick(list[active]!.value);
    else if (e.key === 'Escape') hide();
    else if (e.key === 'Tab') return hide(false);
    else return;
    e.preventDefault();
  };

  const live = clusterOf(settings) === 'mainnet';
  const label = compact ? (settings.network === 'custom' ? 'Custom' : networkLabel(settings).replace('net', '')) : networkLabel(settings);
  const row = (item: Item, i: number) => (
    <div
      key={item.value}
      id={`${id}-${i}`}
      role="option"
      aria-selected={item.value === current}
      onPointerEnter={() => setActive(i)}
      onClick={() => pick(item.value)}
      className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 ${i === active ? 'bg-surface-2' : ''}`}
    >
      <span aria-hidden="true" className={`size-2 flex-none rounded-full ${item.live ? 'bg-ok' : 'bg-warn'}`} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-sm ${item.value === current ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
        <span className={`truncate text-xs text-muted ${i < BUILT_IN.length ? 'font-mono' : ''}`}>{item.detail}</span>
      </span>
      {item.value === current && <Icon name="check" size={16} className="flex-none text-primary" />}
    </div>
  );

  return (
    <div ref={box} data-testid="network-picker" className="relative inline-flex min-w-0">
      <button
        ref={button}
        type="button"
        aria-label={`Network: ${networkLabel(settings)}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            show();
          }
        }}
        className={`inline-flex min-w-0 items-center gap-[5px] rounded-full border bg-surface text-xs text-ink ${open ? 'border-line-strong' : 'border-line'} ${compact ? 'h-8 px-2.5' : 'h-6 px-2'}`}
      >
        <span aria-hidden="true" className={`size-1.5 flex-none rounded-full ${live ? 'bg-ok' : 'bg-warn'}`} />
        <span className="truncate">{label}</span>
        <Icon name="chevron-down" size={12} className={`flex-none text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          style={pos}
          className="fixed z-50 flex flex-col rounded-2xl border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(20,23,31,0.14)]"
        >
          <div
            ref={listbox}
            id={`${id}-list`}
            role="listbox"
            aria-label="Network"
            tabIndex={-1}
            aria-activedescendant={`${id}-${active}`}
            onKeyDown={onKey}
            style={{ maxHeight: `max(160px, min(340px, calc(100vh - ${Math.round(pos.top) + 64}px)))` }}
            className="flex flex-col overflow-y-auto outline-none"
          >
            <div role="group" aria-label="Networks" className="flex flex-col">
              {list.slice(0, BUILT_IN.length).map(row)}
            </div>
            {customs > 0 && (
              <div role="group" aria-labelledby={`${id}-custom`} className="mt-1 flex flex-col border-t border-line-soft pt-1">
                <div id={`${id}-custom`} className="px-2.5 pb-0.5 pt-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Custom RPCs
                </div>
                {list.slice(BUILT_IN.length).map((item, i) => row(item, i + BUILT_IN.length))}
              </div>
            )}
          </div>
          <div aria-hidden="true" className="mx-1 my-1 border-t border-line-soft" />
          <button
            type="button"
            onClick={() => {
              hide(false);
              nav.go({ name: 'settings/network' });
            }}
            className="flex min-h-10 items-center rounded-lg border-0 bg-transparent px-2.5 text-left text-xs text-info"
          >
            Add or manage RPCs
          </button>
        </div>
      )}
    </div>
  );
}
