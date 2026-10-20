import type { Contact, Settings, UserIdl } from '@clef/wallet-core';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Icon, ListGroup, PopupScreen, Segmented, SectionLabel, Spinner, TextField, Toggle } from '../../../components';
import { call } from '../../../lib/api';
import { sidePanelApi } from '../../../lib/side-panel';
import { useCall, useClients, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';
import { clusterOf, networkLabel } from '../../../lib/network';

type DetailLevel = Settings['detailLevel'];

const LEVEL_HINT: Record<DetailLevel, string> = {
  basic: 'Plain-language summary and balance changes. Warnings show at every level.',
  intermediate: 'Instruction names, decoded values and verified accounts. Warnings show at every level.',
  expert: 'Every account change, raw bytes, logs and relations. Warnings show at every level.',
};

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 60, 240, 1440];

export const NETWORK_LABEL: Record<Settings['network'], string> = { mainnet: 'Mainnet', devnet: 'Devnet', localnet: 'Local', custom: 'Custom' };

export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = m / 60;
  return Number.isInteger(h) ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${m} min`;
}

export function rpcHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Whether the active RPC serves the DAS API; null while probing. */
export function useDas(): boolean | null {
  const clients = useClients();
  const [das, setDas] = useState<boolean | null>(null);
  useEffect(() => {
    if (!clients) return;
    let live = true;
    setDas(null);
    clients.portfolio.hasDas().then(
      (v) => live && setDas(v),
      () => live && setDas(false),
    );
    return () => {
      live = false;
    };
  }, [clients]);
  return das;
}

/** settings:update then refresh the wallet state; returns the error text, if any. */
export function useSettingsPatch(): { save: (patch: Partial<Settings>) => Promise<boolean>; error: string | null } {
  const { refresh } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Partial<Settings>) => {
    setError(null);
    try {
      await call({ type: 'settings:update', patch });
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      return false;
    }
  };
  return { save, error };
}

function Row({ label, value, onClick, first }: { label: string; value?: ReactNode; onClick: () => void; first?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 w-full items-center gap-2 px-3 text-left text-sm text-ink ${first ? '' : 'border-t border-line-soft'}`}
    >
      <span className="flex-1">{label}</span>
      {value}
      <Icon name="chevron-right" size={14} className="text-muted" />
    </button>
  );
}

export function SettingsScreen() {
  const nav = useNav();
  const { state } = useWallet();
  const { save, error } = useSettingsPatch();
  const [lockError, setLockError] = useState<string | null>(null);
  const contacts = useCall<Contact[]>('contacts:list');
  const idls = useCall<UserIdl[]>('idls:list');
  const das = useDas();
  const [jupKey, setJupKey] = useState<string | null>(null);

  if (!state) {
    return (
      <PopupScreen title="Settings" onBack={nav.back}>
        <Spinner />
      </PopupScreen>
    );
  }
  const s = state.settings;
  const keyDraft = jupKey ?? s.jupiterApiKey ?? '';
  const keyDirty = keyDraft.trim() !== (s.jupiterApiKey ?? '');
  const lockOptions = AUTO_LOCK_OPTIONS.includes(s.autoLockMinutes) ? AUTO_LOCK_OPTIONS : [...AUTO_LOCK_OPTIONS, s.autoLockMinutes].sort((a, b) => a - b);
  const userIdls = idls.data?.length ?? 0;

  return (
    <PopupScreen
      title="Settings"
      onBack={nav.back}
      scroll
      right={
        <Button
          variant="secondary"
          size="sm"
          icon="lock"
          onClick={async () => {
            setLockError(null);
            try {
              await call({ type: 'vault:lock' });
            } catch (e) {
              setLockError(e instanceof Error ? e.message : 'Could not lock the wallet');
              return;
            }
            nav.reset({ name: 'unlock' });
          }}
        >
          Lock now
        </Button>
      }
    >
      <div className="flex flex-col gap-1.5 px-3 pb-3 pt-2.5">
        {lockError && <Alert severity="danger">{lockError}</Alert>}
        {error && <Alert severity="danger">{error}</Alert>}

        <SectionLabel>Signing detail</SectionLabel>
        <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-2.5">
          <Segmented<DetailLevel>
            ariaLabel="Signing detail level"
            fill
            options={[
              { value: 'basic', label: 'Basic' },
              { value: 'intermediate', label: 'Intermediate' },
              { value: 'expert', label: 'Expert' },
            ]}
            value={s.detailLevel}
            onChange={(detailLevel) => void save({ detailLevel })}
          />
          <span className="px-0.5 text-xs text-muted">{LEVEL_HINT[s.detailLevel]}</span>
        </section>

        <div className="mt-4">
          <SectionLabel>Security</SectionLabel>
        </div>
        <ListGroup>
          <label className="flex h-11 items-center gap-2 px-3 text-sm text-ink">
            <span className="flex-1">Auto-lock</span>
            <select
              aria-label="Auto-lock"
              className="bg-transparent text-right text-xs text-muted"
              value={s.autoLockMinutes}
              onChange={(e) => void save({ autoLockMinutes: Number(e.target.value) })}
            >
              {lockOptions.map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <Row label="Connected sites" value={<span className="text-xs text-muted">{state.permissions.length}</span>} onClick={() => nav.go({ name: 'settings/sites' })} />
          <Row label="Password & recovery phrase" onClick={() => nav.go({ name: 'settings/security' })} />
        </ListGroup>

        <div className="mt-4">
          <SectionLabel>Network &amp; data</SectionLabel>
        </div>
        <ListGroup>
          <Row
            first
            label="Network"
            value={
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${clusterOf(s) === 'mainnet' ? 'bg-ok' : 'bg-warn'}`} />
                {networkLabel(s)}
              </span>
            }
            onClick={() => nav.go({ name: 'settings/network' })}
          />
          <Row
            label="RPC"
            value={
              <>
                <span className="max-w-[140px] truncate font-mono text-xs text-muted">{rpcHost(s.rpcUrl)}</span>
                {das && <span className="rounded bg-ok-bg px-1.5 py-px text-xs text-ok-ink">DAS</span>}
              </>
            }
            onClick={() => nav.go({ name: 'settings/network' })}
          />
          <Row label="Program IDLs" value={<span className="text-xs text-muted">{userIdls} added by you</span>} onClick={() => nav.go({ name: 'settings/idls' })} />
          <Row label="Address book & labels" value={<span className="text-xs text-muted">{contacts.data?.length ?? 0}</span>} onClick={() => nav.go({ name: 'settings/contacts' })} />
          <div className="border-t border-line-soft">
            <Toggle label="Hide spam tokens" checked={s.hideSpam} onChange={(hideSpam) => void save({ hideSpam })} />
          </div>
          {sidePanelApi() && (
            <div className="border-t border-line-soft">
              <Toggle
                label="Open Clef in the side panel"
                checked={s.openIn === 'panel'}
                onChange={(on) => void save({ openIn: on ? 'panel' : 'popup' })}
              />
            </div>
          )}
        </ListGroup>

        <div className="mt-4">
          <SectionLabel>Swaps</SectionLabel>
        </div>
        <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-2.5">
          <TextField
            label="Jupiter API key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            mono
            placeholder="Optional; keyless works with lower limits"
            value={keyDraft}
            onChange={(e) => setJupKey(e.target.value)}
          />
          {keyDirty && (
            <Button
              size="sm"
              onClick={async () => {
                const v = keyDraft.trim();
                if (await save({ jupiterApiKey: v === '' ? null : v })) setJupKey(null);
              }}
            >
              Save key
            </Button>
          )}
        </section>

        {state.errorReportsAvailable && (
          <>
            <div className="mt-4">
              <SectionLabel>Privacy</SectionLabel>
            </div>
            <ListGroup>
              <Toggle
                label="Send error reports"
                description="Off by default. A report holds the error message, stack, Clef version, browser and the site's hostname; addresses, signatures and amounts are removed."
                checked={s.errorReports}
                onChange={(errorReports) => void save({ errorReports })}
              />
            </ListGroup>
          </>
        )}
      </div>
    </PopupScreen>
  );
}
