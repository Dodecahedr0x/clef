import '../lib/node-globals';
import { KitChainReader, KitPortfolioReader } from '@clef/rpc';
import { buildProposeTransactions, fetchMultisig } from '@clef/squads';
import { Vault } from '@clef/vault';
import {
  AccountStore,
  AutoLock,
  ContactStore,
  ErrorReporter,
  InternalApi,
  PermissionStore,
  PhishingListStore,
  RequestLog,
  SettingsStore,
  UserIdlStore,
  WalletService,
  type SquadsClient,
} from '@clef/wallet-core';
import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { AlarmScheduler } from '../lib/alarm-scheduler';
import { ApprovalQueue } from '../lib/approvals';
import { ChromeStore } from '../lib/chrome-store';
import { browserLabel, errorEndpoint, installErrorHandlers } from '../lib/errors';
import { dappOrigin, isExtensionPage } from '../lib/guards';
import { DAPP_PORT, type DappPortReply, type InternalMessage, type InternalReply } from '../lib/messages';
import { schedulePhishingRefresh } from '../lib/phishing';
import { parseDecision, serializeApproval } from '../lib/serialize';
import { approvalWindowSize, openApprovalWindow } from '../lib/windows';

type Port = Browser.runtime.Port;

export default defineBackground(() => {
  // Session storage defaults to trusted contexts; assert it so content scripts can never read the session key.
  void browser.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });

  const local = new ChromeStore(browser.storage.local);
  const vault = new Vault(local, new ChromeStore(browser.storage.session));
  const accounts = new AccountStore(local);
  const permissions = new PermissionStore(local);
  const settings = new SettingsStore(local);
  const contacts = new ContactStore(local);
  const userIdls = new UserIdlStore(local);
  const log = new RequestLog(local);
  const phishing = new PhishingListStore({ store: local });
  const extensionBase = browser.runtime.getURL('/' as never);

  const reporter = new ErrorReporter({
    endpoint: errorEndpoint(import.meta.env.CLEF_ERROR_ENDPOINT),
    enabled: async () => (await settings.get()).errorReports,
    version: browser.runtime.getManifest().version,
    browser: browserLabel(navigator.userAgent),
  });
  installErrorHandlers(self, reporter);
  const reportError = (area: string) => (e: unknown) => void reporter.report(e, { area });

  void schedulePhishingRefresh(browser.alarms, phishing, reportError('phishing-refresh'));

  const rpcUrl = async () => (await settings.get()).rpcUrl;
  const squads: SquadsClient = {
    fetchMultisig: async (multisig) => fetchMultisig(new KitChainReader(await rpcUrl()), multisig),
    buildProposeTransactions,
    latestBlockhash: async () => (await new KitPortfolioReader(await rpcUrl()).getLatestBlockhash()).blockhash,
    confirm: async (sig) => {
      const reader = new KitPortfolioReader(await rpcUrl());
      return reader.confirm(sig, (await reader.getLatestBlockhash()).lastValidBlockHeight);
    },
  };

  const queue = new ApprovalQueue(
    async (id, request) => {
      const size = approvalWindowSize(request, (await settings.get()).detailLevel);
      return openApprovalWindow({ windows: browser.windows, runtime: { getURL: (p) => browser.runtime.getURL(p as never) } }, id, size);
    },
    (windowId) => void browser.windows.remove(windowId).catch(() => {}),
  );
  browser.windows.onRemoved.addListener((windowId) => queue.windowClosed(windowId));

  const scheduler = new AlarmScheduler(browser.alarms);
  const lock = async () => {
    await vault.lock();
  };
  const autoLock = new AutoLock(scheduler, lock, async () => (await settings.get()).autoLockMinutes);
  scheduler.attach(() => void lock()); // the alarm may predate this service-worker instance

  const ports = new Map<string, Set<Port>>();
  const emit = (origin: string, accts: string[]) => {
    const reply: DappPortReply = { type: 'event', accounts: accts };
    for (const port of ports.get(origin) ?? []) port.postMessage(reply);
  };

  const service = new WalletService({
    vault,
    accounts,
    permissions,
    settings,
    sender: { send: async (wire, options) => new KitChainReader(await rpcUrl()).send(wire, options) },
    approver: queue,
    emit,
    activity: () => autoLock.touch(),
    phishing,
    log,
    squads,
  });

  const internal = new InternalApi({
    vault,
    accounts,
    permissions,
    settings,
    onLock: () => autoLock.stop(),
    onUnlock: () => autoLock.touch(),
    emit,
    contacts,
    userIdls,
    log,
    phishing,
    reporter,
    service,
  });

  browser.runtime.onConnect.addListener((port: Port) => {
    if (port.name !== DAPP_PORT) return port.disconnect();
    const origin = port.sender ? dappOrigin(port.sender, extensionBase) : null;
    if (!origin) return port.disconnect();
    const set = ports.get(origin) ?? new Set<Port>();
    set.add(port);
    ports.set(origin, set);
    port.onDisconnect.addListener(() => {
      set.delete(port);
      if (set.size === 0) ports.delete(origin);
    });
    port.onMessage.addListener((msg: unknown) => {
      const m = msg as { type?: unknown; request?: unknown } | null;
      if (m?.type !== 'request') return;
      void service.handle(origin, m.request).then((response) => {
        try {
          port.postMessage({ type: 'response', response } satisfies DappPortReply);
        } catch {
          // the page went away; nothing to deliver
        }
      });
    });
  });

  const handleInternal = async (msg: InternalMessage): Promise<unknown> => {
    if (msg.channel === 'internal') {
      await autoLock.touch();
      return internal.call(msg.call);
    }
    if (msg.channel === 'approval' && typeof msg.id === 'string') {
      if (msg.op === 'get') {
        const req = queue.get(msg.id);
        return req ? serializeApproval(req) : null;
      }
      if (msg.op === 'decide') {
        queue.decide(msg.id, parseDecision(msg.decision));
        return {};
      }
    }
    throw new Error('Unknown message');
  };

  browser.runtime.onMessage.addListener((msg: unknown, sender: Browser.runtime.MessageSender) => {
    if (!isExtensionPage(sender, browser.runtime.id, extensionBase)) return undefined;
    return handleInternal(msg as InternalMessage).then(
      (value): InternalReply => ({ ok: true, value }),
      (e: unknown): InternalReply => ({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }),
    );
  });
});
