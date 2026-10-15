#!/usr/bin/env -S npx tsx
import { KitChainReader } from '@clef/rpc';
import { run, writeFileAtomic } from './run';

process.exitCode = await run(process.argv.slice(2), process.env, {
  makeReader: (url) => new KitChainReader(url),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  writeFile: writeFileAtomic,
});
