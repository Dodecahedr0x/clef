import { writeFileSync } from 'node:fs';
import { explain, viewFor } from '@clef/explain';
import { createDefaultResolver, UserIdlSource } from '@clef/idl';
import { KitChainReader, RecordingChainReader, type ChainReader, type TxMeta } from '@clef/rpc';
import { getBase64Encoder } from '@solana/kit';
import { parseCli, USAGE } from './args';
import { clean, hasDanger, renderView } from './render';

async function main(): Promise<number> {
  const opts = parseCli(process.argv.slice(2), process.env);
  if ('usage' in opts) {
    if (opts.error) console.error(clean(opts.error));
    console.error(USAGE);
    return 2;
  }
  if ('error' in opts) {
    console.error(clean(opts.error));
    return 2;
  }

  const live = new KitChainReader(opts.rpc);
  const recorder = opts.record ? new RecordingChainReader(live) : null;
  const reader: ChainReader = recorder ?? live;
  try {
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

    const ex = await explain(
      { wire, meta },
      { reader, idls: createDefaultResolver(reader, new UserIdlSource()), me: opts.me, addressBook: opts.labels },
    );
    const view = viewFor(ex, opts.level);
    console.log(renderView(view));
    return hasDanger(view) ? 3 : 0;
  } finally {
    // Written even when explaining failed: that is when a fixture is most useful.
    if (recorder && opts.record) {
      writeFileSync(opts.record, recorder.toFixture({ signature: opts.signature, tx: opts.tx, me: opts.me, labels: opts.labels }));
      console.error(`\nRecorded fixture -> ${clean(opts.record)}`);
    }
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(clean(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  },
);
