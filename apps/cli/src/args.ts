import { parseArgs } from 'node:util';
import { sanitizeText, type DetailLevel } from '@clef/explain';
import { isAddress, isSignature, type Address } from '@solana/kit';

export const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

export const USAGE = `Usage:
  clef explain <signature> [options]     explain a landed transaction (from its meta)
  clef explain --tx <base64> [options]   explain a wire transaction (simulated)

Options:
  --level basic|intermediate|expert   detail level (default: intermediate)
  --me <address>                      a wallet of yours; repeatable (without it, Clef
                                      assumes you are the fee payer)
  --label <address>=<name>            name an address; repeatable
  --rpc <url>                         RPC endpoint (default: $CLEF_RPC, else ${DEFAULT_RPC})
  --record <file>                     also write the chain reads to a replayable fixture

For sponsored/gasless transactions the fee payer is not you: pass --me.

Exit codes:
  0  explained, no danger
  1  error (network, undecodable transaction, ...)
  2  usage error
  3  explained, and at least one DANGER warning`;

export type CliOptions = {
  signature?: string;
  tx?: string;
  level: DetailLevel;
  me: Address[];
  labels: Record<string, string>;
  rpc: string;
  record?: string;
};

export type CliParse = CliOptions | { usage: true; error?: string } | { error: string };

const LEVELS: readonly string[] = ['basic', 'intermediate', 'expert'];
const MAX_LABEL = 64;
/** Canonical, padded base64 of at least one byte. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/;

/** Parses `argv` (without the node/script prefix). Never throws. */
export function parseCli(argv: readonly string[], env: Record<string, string | undefined>): CliParse {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        level: { type: 'string', default: 'intermediate' },
        me: { type: 'string', multiple: true, default: [] },
        label: { type: 'string', multiple: true, default: [] },
        rpc: { type: 'string' },
        tx: { type: 'string' },
        record: { type: 'string' },
      },
    });
  } catch (e) {
    return { usage: true, error: e instanceof Error ? e.message : String(e) };
  }
  const { values, positionals } = parsed;
  const [command, signature, ...extra] = positionals;
  if (command !== 'explain' || extra.length || !signature === !values.tx) return { usage: true };
  if (!LEVELS.includes(values.level)) return { usage: true, error: `unknown level: ${values.level}` };
  // A signature is base58 of 64 bytes.
  if (signature && !isSignature(signature)) return { usage: true, error: `not a transaction signature: ${signature}` };
  if (values.tx !== undefined && !BASE64.test(values.tx)) return { usage: true, error: '--tx: not valid base64' };

  const me: Address[] = [];
  for (const m of values.me) {
    if (!isAddress(m)) return { error: `--me: not a valid address: ${m}` };
    me.push(m);
  }
  const labels: Record<string, string> = {};
  for (const entry of values.label) {
    const at = entry.indexOf('=');
    const key = entry.slice(0, at);
    const name = sanitizeText(entry.slice(at + 1), MAX_LABEL).trim();
    if (at < 0 || !isAddress(key) || !name) return { error: `--label: expected <address>=<name>, got: ${entry}` };
    labels[key] = name;
  }

  return {
    ...(signature && { signature }),
    ...(values.tx && { tx: values.tx }),
    level: values.level as DetailLevel,
    me,
    labels,
    rpc: values.rpc ?? (env.CLEF_RPC || DEFAULT_RPC),
    ...(values.record && { record: values.record }),
  };
}
