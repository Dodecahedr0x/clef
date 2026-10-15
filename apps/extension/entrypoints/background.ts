import { KitChainReader } from '@clef/rpc';
import { Vault } from '@clef/vault';
import { AccountStore, AutoLock, InternalApi, PermissionStore, SettingsStore, WalletService } from '@clef/wallet-core';
import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { AlarmScheduler } from '../lib/alarm-scheduler';
import { ApprovalQueue } from '../lib/approvals';
import { ChromeStore } from '../lib/chrome-store';
import { dappOrigin, isExtensionPage } from '../lib/guards';
import { DAPP_PORT, type DappPortReply, type InternalMessage, type InternalReply } from '../lib/messages';
import { parseDecision, serializeApproval } from '../lib/serialize';

type Port = Browser.runtime.Port;

const APPROVAL_SIZE = { width: 400, height: 640 };

export default defineBackground(() => {
  // Session storage defaults to trusted contexts; assert it so content scripts can never read the session key.
  void browser.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });

  const local = new ChromeStore(browser.storage.local);
  const vault = new Vault(local, new ChromeStore(browser.storage.session));
  const accounts = new AccountStore(local);
  const permissions = new PermissionStore(local);
  const settings = new SettingsStore(local);
  const extensionBase = browser.runtime.getURL('/' as never);

  const queue = new ApprovalQueue(
    async (id) => {
      const win = await browser.windows.create({
        url: browser.runtime.getURL(`/approval.html?id=${encodeURIComponent(id)}` as never),
        type: 'popup',
        focused: true,
        ...APPROVAL_SIZE,
      });
      return win?.id;
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
    sender: { send: async (wire, options) => new KitChainReader((await settings.get()).rpcUrl).send(wire, options) },
    approver: queue,
    emit,
    activity: () => autoLock.touch(),
  });

  const internal = new InternalApi({
    vault,
    accounts,
    permissions,
    settings,
    onLock: () => autoLock.stop(),
    onUnlock: () => autoLock.touch(),
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
