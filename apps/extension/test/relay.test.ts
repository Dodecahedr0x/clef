import { describe, expect, it } from 'vitest';
import { startRelay, type PortLike } from '../lib/relay';

function setup() {
  const handlers: ((e: MessageEvent) => void)[] = [];
  const toPage: unknown[] = [];
  const win = {
    location: { origin: 'https://dapp.example' },
    addEventListener: (_t: string, h: (e: MessageEvent) => void) => handlers.push(h),
    postMessage: (data: unknown) => toPage.push(data),
  };
  const ports: { sent: unknown[]; reply: (m: unknown) => void; drop: () => void }[] = [];
  const connect = (): PortLike => {
    let onMsg: (m: unknown) => void = () => {};
    let onDrop: () => void = () => {};
    const entry = { sent: [] as unknown[], reply: (m: unknown) => onMsg(m), drop: () => onDrop() };
    ports.push(entry);
    return {
      postMessage: (m) => entry.sent.push(m),
      onMessage: { addListener: (cb) => (onMsg = cb) },
      onDisconnect: { addListener: (cb) => (onDrop = cb) },
    };
  };
  startRelay(win as any, connect);
  const fromPage = (data: unknown, source: unknown = win, origin = 'https://dapp.example') =>
    handlers.forEach((h) => h({ data, source, origin } as MessageEvent));
  return { ports, toPage, fromPage };
}

describe('relay', () => {
  it('forwards page requests and posts responses and events back', () => {
    const { ports, toPage, fromPage } = setup();
    fromPage({ source: 'clef-inpage', id: 'r1', method: 'connect', params: {} });
    expect(ports[0]!.sent).toEqual([{ type: 'request', request: { id: 'r1', method: 'connect', params: {} } }]);
    ports[0]!.reply({ type: 'response', response: { id: 'r1', ok: true, result: {} } });
    ports[0]!.reply({ type: 'event', accounts: ['a'] });
    expect(toPage).toEqual([
      { source: 'clef-relay', response: { id: 'r1', ok: true, result: {} } },
      { source: 'clef-relay', event: { accounts: ['a'] } },
    ]);
  });

  it('does not connect until the page makes a request, and ignores foreign messages', () => {
    const { ports, fromPage } = setup();
    expect(ports).toEqual([]);
    fromPage({ source: 'clef-inpage', id: 'r1', method: 'connect' }, {});
    fromPage({ source: 'clef-inpage', id: 'r1', method: 'connect' }, undefined, 'https://evil.example');
    fromPage({ source: 'other', id: 'r1' });
    fromPage({ source: 'clef-inpage', id: 5 });
    expect(ports).toEqual([]);
  });

  it('reconnects after the service worker drops the port', () => {
    const { ports, fromPage } = setup();
    fromPage({ source: 'clef-inpage', id: 'r1', method: 'connect', params: {} });
    ports[0]!.drop();
    fromPage({ source: 'clef-inpage', id: 'r2', method: 'connect', params: {} });
    expect(ports).toHaveLength(2);
    expect(ports[1]!.sent).toHaveLength(1);
  });
});
