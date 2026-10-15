import ata from '../idls/associated-token-account.json' with { type: 'json' };
import computeBudget from '../idls/compute-budget.json' with { type: 'json' };
import memo from '../idls/memo.json' with { type: 'json' };
import system from '../idls/system.json' with { type: 'json' };
import token2022 from '../idls/token-2022.json' with { type: 'json' };
import token from '../idls/token.json' with { type: 'json' };
import { StaticIdlSource } from './static-source';

// Memo v4 (Memo4c2p…) is wire-compatible with v3 (MemoSq4…), and the vendored IDL targets v4. Codama matches
// a program by its exact address, so the v3 alias needs its own root.
const memoV3 = { ...memo, program: { ...memo.program, publicKey: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' } };

const BUNDLED: { program: { publicKey: string } }[] = [system, token, token2022, ata, computeBudget, memo, memoV3];

export function createBundledSource(): StaticIdlSource {
  return new StaticIdlSource('bundled', 'curated', new Map(BUNDLED.map((idl) => [idl.program.publicKey, idl])));
}
