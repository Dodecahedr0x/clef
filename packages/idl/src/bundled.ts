import ata from '../idls/associated-token-account.json' with { type: 'json' };
import computeBudget from '../idls/compute-budget.json' with { type: 'json' };
import memo from '../idls/memo.json' with { type: 'json' };
import system from '../idls/system.json' with { type: 'json' };
import token2022 from '../idls/token-2022.json' with { type: 'json' };
import token from '../idls/token.json' with { type: 'json' };
import { StaticIdlSource } from './static-source';

const BUNDLED: { program: { publicKey: string } }[] = [system, token, token2022, ata, computeBudget, memo];

export function createBundledSource(): StaticIdlSource {
  return new StaticIdlSource('bundled', 'curated', new Map(BUNDLED.map((idl) => [idl.program.publicKey, idl])));
}
