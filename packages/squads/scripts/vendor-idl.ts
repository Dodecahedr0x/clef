// Vendors the Squads v4 Anchor IDL (pinned commit + sha256) as a Codama root into packages/idl/idls/squads-v4.json.
// Run: pnpm tsx packages/squads/scripts/vendor-idl.ts
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';

const COMMIT = 'af94153ff77a28b6effe46b9c94baaa93742b48c';
const PATH = 'sdk/multisig/idl/squads_multisig_program.json';
const SHA256 = 'cb9a0a29040ec3853a5105c547ffc608bb0e3175d78dacf30d463aff939f9b9b';

const res = await fetch(`https://raw.githubusercontent.com/Squads-Protocol/v4/${COMMIT}/${PATH}`);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const text = await res.text();
const sha = createHash('sha256').update(text).digest('hex');
if (sha !== SHA256) throw new Error(`sha256 mismatch: ${sha}`);

const root = rootNodeFromAnchor(JSON.parse(text) as AnchorIdl);
if (root.program.publicKey !== 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf') throw new Error('unexpected program id');
const out = join(import.meta.dirname, '../../idl/idls/squads-v4.json');
const json = `${JSON.stringify(root, null, 2)}\n`;
writeFileSync(out, json);
console.log(`source sha256 ${sha}; squads-v4.json sha256 ${createHash('sha256').update(json).digest('hex')}`);
