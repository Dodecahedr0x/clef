import { describe, expect, it, vi } from 'vitest';
import { browserLabel, errorEndpoint, installErrorHandlers, type Reporter } from '../lib/errors';

function scope() {
  const listeners = new Map<string, (e: unknown) => void>();
  return { listeners, addEventListener: (type: string, cb: (e: unknown) => void) => void listeners.set(type, cb) };
}

describe('error reporting wiring', () => {
  it.each([undefined, null, '', '   ', 'not a url', 'http://errors.example/r', 'ftp://errors.example', 5])('CLEF_ERROR_ENDPOINT %j -> no endpoint', (raw) => {
    expect(errorEndpoint(raw)).toBeNull();
  });

  it('accepts an https endpoint', () => {
    expect(errorEndpoint('https://errors.example/v1/report')).toBe('https://errors.example/v1/report');
  });

  it('the build leaves CLEF_ERROR_ENDPOINT unset by default', () => {
    expect(errorEndpoint(import.meta.env.CLEF_ERROR_ENDPOINT)).toBeNull();
  });

  it('installs no global handlers when the reporter is unavailable', () => {
    const s = scope();
    const reporter: Reporter = { available: false, report: vi.fn() };
    expect(installErrorHandlers(s, reporter)).toBe(false);
    expect(s.listeners.size).toBe(0);
  });

  it('forwards uncaught errors and rejections from the service worker when available', async () => {
    const s = scope();
    const report = vi.fn(async () => {});
    expect(installErrorHandlers(s, { available: true, report })).toBe(true);
    const boom = new Error('boom');
    s.listeners.get('error')!({ error: boom });
    s.listeners.get('unhandledrejection')!({ reason: 'nope' });
    expect(report).toHaveBeenNthCalledWith(1, boom, { area: 'background' });
    expect(report).toHaveBeenNthCalledWith(2, 'nope', { area: 'background' });
  });

  it('a failing report never throws out of the handler', () => {
    const s = scope();
    installErrorHandlers(s, { available: true, report: () => Promise.reject(new Error('offline')) });
    expect(() => s.listeners.get('error')!({ error: new Error('x') })).not.toThrow();
  });

  it('labels the browser without the full user agent', () => {
    expect(browserLabel('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141.0.7390.54 Safari/537.36')).toBe('chrome/141');
    expect(browserLabel('curl/8')).toBe('unknown');
  });
});
