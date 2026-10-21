import { DEFAULT_RPC, type CustomRpc, type Settings } from '@clef/wallet-core';
import { Icon } from '../../../components';
import { call } from '../../../lib/api';
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

/**
 * The network chip, as a native select over every built-in network and saved custom RPC: the platform list is
 * keyboard and screen-reader ready, and fits any width.
 */
export function NetworkPicker({ settings, compact = false }: { settings: Settings; compact?: boolean }) {
  const customs = settings.customRpcs ?? [];
  const labels = customRpcLabels(customs);
  const live = clusterOf(settings) === 'mainnet';
  return (
    <span
      data-testid="network-picker"
      className={`relative inline-flex min-w-0 items-center gap-[5px] rounded-full border border-line bg-surface text-xs text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-primary ${compact ? 'h-8 px-2.5' : 'px-2 py-0.5'}`}
    >
      <span aria-hidden="true" className={`size-1.5 flex-none rounded-full ${live ? 'bg-ok' : 'bg-warn'}`} />
      <span aria-hidden="true" className="truncate">
        {compact ? (settings.network === 'custom' ? 'Custom' : networkLabel(settings).replace('net', '')) : networkLabel(settings)}
      </span>
      <Icon name="chevron-down" size={12} className="flex-none text-muted" />
      <select
        aria-label="Network"
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        value={pickerValue(settings)}
        onChange={(e) => {
          const patch = patchFor(e.target.value, settings);
          if (patch) void call({ type: 'settings:update', patch });
        }}
      >
        {BUILT_IN.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {customs.length > 0 && (
          <optgroup label="Custom RPCs">
            {customs.map((r, i) => (
              <option key={r.url} value={`custom:${r.url}`}>
                {labels[i]}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </span>
  );
}
