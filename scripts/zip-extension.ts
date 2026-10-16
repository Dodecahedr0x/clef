// Packages the built Chrome extension (apps/extension/.output/chrome-mv3) into a store-ready zip with
// manifest.json at the root. No external zip tool: a minimal deflate zip writer on node:zlib.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const USAGE = `Usage: pnpm tsx scripts/zip-extension.ts [--dir <built extension dir>] [--out <zip path>]

Defaults: --dir apps/extension/.output/chrome-mv3
          --out apps/extension/.output/clef-<manifest version>-chrome.zip
Run "pnpm build:ext" first.`;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Dev-only pages that never ship to the store. */
const DEV_ONLY = /(^|\/)kitchen-sink[.-]/;

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return listFiles(path, root);
      return DEV_ONLY.test(relative(root, path).split(sep).join('/')) ? [] : [path];
    });
}

// Fixed DOS timestamp (1980-01-01 00:00) so the same build yields the same zip.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function zipDirectory(dir: string): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const path of listFiles(dir)) {
    const name = Buffer.from(relative(dir, path).split(sep).join('/'), 'utf8');
    const data = readFileSync(path);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const count = centrals.length / 2;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args: string[]): void {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const dir = arg(args, '--dir') ?? join('apps', 'extension', '.output', 'chrome-mv3');
  let manifest: { version?: string };
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { version?: string };
  } catch {
    console.error(`No manifest.json in ${dir}. Run "pnpm build:ext" first.\n\n${USAGE}`);
    process.exit(1);
  }
  const out = arg(args, '--out') ?? join('apps', 'extension', '.output', `clef-${manifest.version ?? '0.0.0'}-chrome.zip`);
  const zip = zipDirectory(dir);
  writeFileSync(out, zip);
  console.log(`Wrote ${out} (${(zip.length / 1024).toFixed(0)} KiB)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
