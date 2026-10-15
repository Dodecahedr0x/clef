import { describe, expect, it } from 'vitest';
import { dappOrigin, isExtensionPage } from '../lib/guards';

const EXT = 'chrome-extension://abcdefghijklmnop/';
const ID = 'abcdefghijklmnop';

describe('dappOrigin', () => {
  it('takes the origin from the browser-provided sender of a tab', () => {
    expect(dappOrigin({ origin: 'https://dapp.example', url: 'https://dapp.example/swap', tab: {} }, EXT)).toBe('https://dapp.example');
    expect(dappOrigin({ origin: 'http://localhost:3000', url: 'http://localhost:3000/', tab: {} }, EXT)).toBe('http://localhost:3000');
    expect(dappOrigin({ origin: 'http://127.0.0.1:8080', tab: {} }, EXT)).toBe('http://127.0.0.1:8080');
  });

  it.each([
    ['no origin', { tab: {} }],
    ['not a tab', { origin: 'https://dapp.example' }],
    ['plain http', { origin: 'http://dapp.example', tab: {} }],
    ['opaque origin', { origin: 'null', tab: {} }],
    ['file', { origin: 'file://', tab: {} }],
    ['the extension itself', { origin: 'chrome-extension://abcdefghijklmnop', url: `${EXT}approval.html`, tab: {} }],
    ['another extension', { origin: 'chrome-extension://other', tab: {} }],
  ])('rejects %s', (_name, sender) => {
    expect(dappOrigin(sender, EXT)).toBeNull();
  });
});

describe('isExtensionPage', () => {
  it('accepts only our own extension pages', () => {
    expect(isExtensionPage({ id: ID, url: `${EXT}popup.html` }, ID, EXT)).toBe(true);
    expect(isExtensionPage({ id: ID, url: `${EXT}approval.html?id=1`, tab: {} }, ID, EXT)).toBe(true);
  });

  it('rejects content scripts, which share the extension id', () => {
    expect(isExtensionPage({ id: ID, url: 'https://dapp.example/', tab: {} }, ID, EXT)).toBe(false);
    expect(isExtensionPage({ id: ID }, ID, EXT)).toBe(false);
    expect(isExtensionPage({ id: 'other', url: `${EXT}popup.html` }, ID, EXT)).toBe(false);
  });
});
