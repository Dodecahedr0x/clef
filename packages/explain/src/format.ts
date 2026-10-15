import { shortAddress } from './labels';
import { KNOWN_PROGRAMS } from './registry';
import type { ExplainedInstruction } from './types';

/**
 * `amount` base units as a decimal string. With unknown decimals (null) the raw base units are shown and marked
 * as such: assuming 0 decimals would overstate an amount by up to 10^decimals.
 */
export function formatUnits(amount: bigint, decimals: number | null): string {
  if (decimals === null) return `${amount} (raw units)`;
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = decimals ? (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * How to name a program. Known programs come from Clef's registry, never from an IDL. Any other program's IDL
 * name is the IDL describing itself, so it is qualified with the IDL's trust tier and the program's address:
 * an untrusted IDL calling itself `system` can't pass for the System Program.
 */
export function programDisplay(ix: Pick<ExplainedInstruction, 'programId' | 'programName' | 'idl'>): string {
  const known = KNOWN_PROGRAMS[ix.programId];
  if (known) return known;
  const short = shortAddress(ix.programId);
  return ix.programName ? `${ix.programName} (${ix.idl?.trust ?? 'unknown'} IDL, ${short})` : short;
}
