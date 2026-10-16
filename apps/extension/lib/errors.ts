export type Reporter = { available: boolean; report(e: unknown, ctx: { area: string; origin?: string }): Promise<void> };

/** The build-time endpoint (CLEF_ERROR_ENDPOINT); anything but an https URL means reporting is unavailable. */
export function errorEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Major version only: the full user agent is a fingerprint. */
export function browserLabel(userAgent: string): string {
  const m = /Chrome\/(\d+)/.exec(userAgent);
  return m ? `chrome/${m[1]}` : 'unknown';
}

type ErrorScope = { addEventListener(type: string, cb: (e: unknown) => void): void };

/** Uncaught background errors go to the (opt-in, scrubbing) reporter; returns whether handlers were installed. */
export function installErrorHandlers(scope: ErrorScope, reporter: Reporter): boolean {
  if (!reporter.available) return false;
  const send = (e: unknown) => void reporter.report(e, { area: 'background' }).catch(() => {});
  scope.addEventListener('error', (e) => send((e as { error?: unknown }).error));
  scope.addEventListener('unhandledrejection', (e) => send((e as { reason?: unknown }).reason));
  return true;
}
