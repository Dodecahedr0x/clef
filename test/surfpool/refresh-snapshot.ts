// Regenerates test/surfpool/snapshot.json from public mainnet (run rarely: `pnpm tsx test/surfpool/refresh-snapshot.ts`).
// Output matches surfnet_exportSnapshot so `surfpool start --offline --snapshot` can preload it.
import { getAddressDecoder, getProgramDerivedAddress, address, type Address } from '@solana/kit';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RPC = process.env.CLEF_SNAPSHOT_RPC ?? 'https://api.mainnet-beta.solana.com';
const OUT = join(import.meta.dirname, 'snapshot.json');
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';

const SQUADS_V4 = address('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
const SNAPSHOT_ACCOUNTS: Record<string, Address> = {
  usdcMint: address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  wsolMint: address('So11111111111111111111111111111111111111112'),
  squadsV4: SQUADS_V4,
  orcaWhirlpool: address('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'),
  jupiterV6: address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
};

type RpcAccount = { lamports: number; owner: string; executable: boolean; rentEpoch: number; data: [string, 'base64'] };
type SnapshotAccount = { lamports: number; owner: string; executable: boolean; rentEpoch: number; data: string; parsedData: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getAccount(addr: string): Promise<RpcAccount> {
  for (let attempt = 0; ; attempt++) {
    await sleep(500);
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [addr, { encoding: 'base64' }] }),
    });
    if (res.status === 429 && attempt < 5) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    const body = (await res.json()) as { result?: { value: RpcAccount | null }; error?: unknown };
    if (!body.result?.value) throw new Error(`account ${addr} missing: ${JSON.stringify(body.error ?? null)}`);
    return body.result.value;
  }
}

// ProgramData = [u32 tag = 3][u64 slot][u8 + 32 authority][ELF ...zero padding]. Dropping the padding keeps the
// snapshot small; the ELF ends at its section header table.
const PROGRAMDATA_HEADER = 45;
function trimProgramData(bytes: Buffer): Buffer {
  const elf = bytes.subarray(PROGRAMDATA_HEADER);
  const shoff = Number(elf.readBigUInt64LE(0x28));
  const end = shoff + elf.readUInt16LE(0x3a) * elf.readUInt16LE(0x3c);
  return bytes.subarray(0, PROGRAMDATA_HEADER + Math.min(elf.length, end));
}

async function main(): Promise<void> {
  const [programConfig] = await getProgramDerivedAddress({
    programAddress: SQUADS_V4,
    seeds: [new TextEncoder().encode('multisig'), new TextEncoder().encode('program_config')],
  });
  const queue: string[] = [...Object.values(SNAPSHOT_ACCOUNTS), programConfig];
  const out: Record<string, SnapshotAccount> = {};
  while (queue.length) {
    const addr = queue.shift()!;
    if (out[addr]) continue;
    const acc = await getAccount(addr);
    out[addr] = { lamports: acc.lamports, owner: acc.owner, executable: acc.executable, rentEpoch: 0, data: acc.data[0], parsedData: null };
    let bytes: Buffer = Buffer.from(acc.data[0], 'base64');
    if (acc.owner === UPGRADEABLE_LOADER && bytes.readUInt32LE(0) === 3) {
      bytes = trimProgramData(bytes);
      out[addr]!.data = bytes.toString('base64');
    }
    // Upgradeable program account: [u32 tag = 2][programdata address]
    if (acc.owner === UPGRADEABLE_LOADER && acc.executable && bytes.readUInt32LE(0) === 2) {
      queue.push(getAddressDecoder().decode(bytes.subarray(4, 36)));
    }
    console.log(`${addr} ${bytes.length} bytes`);
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
  console.log(`wrote ${OUT}`);
}

await main();
