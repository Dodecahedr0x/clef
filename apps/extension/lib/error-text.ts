/**
 * Words for failures the user meets: what happened, whether anything was sent, and what to do next. The raw
 * message stays available as `detail` (shown behind "Details"), never as the headline.
 */
export type ErrorText = {
  /** 'neutral' for the user's own choice (cancelled): not an error. */
  tone: 'neutral' | 'danger';
  title: string;
  body?: string;
  /** The underlying message, for "Details". */
  detail?: string;
  /** The fix lives in the RPC settings. */
  rpc?: boolean;
};

/** The user rejected the request (EIP-1193 / Wallet Standard code 4001). */
export const USER_REJECTED = 4001;

const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '');
const code = (e: unknown) => (e as { code?: unknown } | null)?.code;

export const isCancel = (e: unknown) => code(e) === USER_REJECTED || /user rejected/i.test(message(e));

/** A request that never reached (or never got an answer from) the RPC. */
export const isConnectionError = (text: string) =>
  /failed to fetch|networkerror|network request failed|load failed|timed? ?out|ECONN|ENOTFOUND|HTTP (?:error )?\(?(?:4\d\d|5\d\d)|\b(?:403|429|50[0-4])\b|access forbidden|too many requests/i.test(text);

export function rpcHost(url: string | undefined): string {
  if (!url) return 'your RPC';
  try {
    return new URL(url).host;
  } catch {
    return 'your RPC';
  }
}

/** A send or swap that did not go through: cancelled, refused by the network, or never reached it. */
export function sendErrorText(e: unknown, opts: { rpcUrl?: string; slippageBps?: number } = {}): ErrorText {
  const raw = message(e);
  const detail = raw || undefined;
  if (isCancel(e)) return { tone: 'neutral', title: 'Cancelled. Nothing was sent.' };
  if (/cannot sign/i.test(raw)) return { tone: 'danger', title: "This account can't sign", body: 'It is view-only. Switch to an account you can sign with.' };
  if (/insufficient funds for rent/i.test(raw))
    return { tone: 'danger', title: 'Not enough SOL for the account minimum', body: 'An account would be left with less SOL than it must hold. Nothing was sent.', detail };
  if (/insufficient (?:funds|lamports)|no record of a prior credit/i.test(raw))
    return { tone: 'danger', title: 'Not enough SOL for this transaction', body: 'The amount and network fee are more than this account holds. Nothing was sent.', detail };
  if (/slippage|0x1771\b|custom program error: 6001\b|"Custom":6001\b/i.test(raw)) {
    const pct = opts.slippageBps !== undefined ? ` ${(opts.slippageBps / 100).toFixed(1)}%` : '';
    return { tone: 'danger', title: 'The price moved', body: `It moved more than your${pct} slippage before the swap ran. Nothing was swapped. Try again, or raise the slippage.`, detail };
  }
  if (/blockhash not found|block height exceeded|expired/i.test(raw))
    return { tone: 'danger', title: 'Took too long', body: 'The transaction expired before it was sent. Nothing was sent. Try again.', detail };
  if (isConnectionError(raw))
    return { tone: 'danger', title: `Couldn't reach ${rpcHost(opts.rpcUrl)}`, body: 'Nothing was sent. Check your connection, or use another RPC.', detail, rpc: true };
  if (/simulation failed|transaction simulation|preflight/i.test(raw))
    return { tone: 'danger', title: 'The network rejected this transaction', body: 'It would fail if sent, so it was not sent.', detail };
  return { tone: 'danger', title: "Clef couldn't send this transaction", body: 'Check Activity before trying again: a transaction that was sent shows up there.', detail };
}

/** Balances or history that could not be loaded. */
export function loadErrorText(raw: string, rpcUrl?: string): ErrorText {
  if (isConnectionError(raw))
    return { tone: 'danger', title: `Couldn't reach ${rpcHost(rpcUrl)}`, body: 'Your funds are safe: this is a connection problem.', detail: raw, rpc: true };
  return { tone: 'danger', title: "Couldn't load this", body: 'Try again in a moment.', detail: raw };
}
