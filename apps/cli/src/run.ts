import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { explain, viewFor } from '@clef/explain';
import { createDefaultResolver, UserIdlSource } from '@clef/idl';
import { RecordingChainReader, type ChainReader, type TxMeta } from '@clef/rpc';
import { getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder, type Address } from '@solana/kit';
import { parseCli, USAGE } from './args';
import { clean, hasDanger, renderView } from './render';

export type RunDeps = {
  makeReader: (rpcUrl: string) => ChainReader;
  /** One call per block of standard output. */
  out: (text: string) => void;
  err: (text: string) => void;
  writeFile: (path: string, data: string) => void;
};

/** Writes to a temp file next to `path`, then renames it over `path`: a failed write never truncates it. */
export function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, data, { flag: 'wx' });
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** The fee payer: the first static account of the compiled message. */
function feePayerOf(wire: Uint8Array): Address {
  const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(wire).messageBytes);
  const payer = message.staticAccounts[0];
  if (!payer) throw new Error('Transaction has no fee payer');
  return payer;
}

const message = (e: unknown) => clean(e instanceof Error ? e.message : e);

/** The `clef` command. Never throws; resolves to the process exit code (see `USAGE`). */
export async function run(argv: readonly string[], env: Record<string, string | undefined>, deps: RunDeps): Promise<number> {
  const opts = parseCli(argv, env);
  if ('usage' in opts) {
    if (opts.error) deps.err(clean(opts.error));
    deps.err(USAGE);
    return 2;
  }
  if ('error' in opts) {
    deps.err(clean(opts.error));
    return 2;
  }

  let code: number;
  let recorder: RecordingChainReader | null = null;
  let me = opts.me;
  try {
    const live = deps.makeReader(opts.rpc);
    recorder = opts.record ? new RecordingChainReader(live) : null;
    const reader: ChainReader = recorder ?? live;

    let wire: Uint8Array;
    let meta: TxMeta | null = null;
    if (opts.signature) {
      const fetched = await reader.getTransaction(opts.signature);
      if (!fetched) throw new Error(`Transaction ${opts.signature} not found`);
      wire = fetched.wire;
      meta = fetched.meta;
    } else {
      wire = new Uint8Array(getBase64Encoder().encode(opts.tx!));
    }

    // Without --me, every "your wallet" judgment would be empty: judge the fee payer's instead, and say so.
    let note: string | undefined;
    if (me.length === 0) {
      const payer = feePayerOf(wire);
      me = [payer];
      note = `Note: No --me given: assuming you are the fee payer ${clean(payer)}. Pass --me to check other wallets.`;
    }

    const ex = await explain(
      { wire, meta },
      { reader, idls: createDefaultResolver(reader, new UserIdlSource()), me, addressBook: opts.labels },
    );
    const view = viewFor(ex, opts.level);
    deps.out(renderView(view, note));
    code = hasDanger(view) ? 3 : 0;
  } catch (e) {
    deps.err(message(e));
    // Nothing is recorded for a failed run: the record target keeps whatever it held.
    return 1;
  }

  if (recorder && opts.record) {
    try {
      deps.writeFile(opts.record, recorder.toFixture({ signature: opts.signature, tx: opts.tx, me, labels: opts.labels }));
      deps.err(`\nRecorded fixture -> ${clean(opts.record)}`);
    } catch (e) {
      deps.err(`Could not write fixture ${clean(opts.record)}: ${message(e)}`);
    }
  }
  return code;
}
