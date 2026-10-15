import { sanitizeText, type BasicView, type ExpertView, type IntermediateView, type Severity, type Warning } from '@clef/explain';

export type AnyView = BasicView | IntermediateView | ExpertView;

/** Generous: long enough for any instruction's data hex, short enough to never flood a terminal. */
const MAX_FIELD = 8192;

/**
 * Every string printed goes through here, whatever its source: strips C0/C1 controls (terminal escapes,
 * carriage returns, newlines), zero-width and bidi characters. The views are sanitized upstream already; the
 * terminal must not depend on that.
 */
export function clean(value: unknown): string {
  return sanitizeText(String(value), MAX_FIELD);
}

const RANK: Record<Severity, number> = { danger: 0, warn: 1, info: 2 };
const PREFIX: Record<Severity, string> = { danger: 'DANGER', warn: 'Warning', info: 'Note' };
const RELATION: Record<string, string> = { verified: '\u2713', mismatch: '\u2717 MISMATCH', unverified: '?' };

export const hasDanger = (view: AnyView): boolean => view.warnings.some((w) => w.severity === 'danger');

/** Danger, then warn, then info; the order within a severity is kept. */
function ordered(warnings: readonly Warning[]): Warning[] {
  return [...warnings].sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3));
}

export function renderView(view: AnyView): string {
  const lines: string[] = [];
  const dangers = view.warnings.filter((w) => w.severity === 'danger').length;
  if (dangers) lines.push(`!!! DANGER: ${dangers} serious problem${dangers === 1 ? '' : 's'} found. Do not sign unless you are certain. !!!`, '');

  lines.push(clean(view.summary), '');
  for (const w of ordered(view.warnings)) lines.push(`${PREFIX[w.severity] ?? 'Note'}: ${clean(w.message)}`);
  if (view.warnings.length) lines.push('');

  const expert = view.level === 'expert';
  if (expert) lines.push(`Network fee: ${view.fee === null ? 'unknown' : clean(view.fee)}`, '');
  else if (view.fee !== undefined) lines.push(`Network fee: ${clean(view.fee)}`, '');

  if (view.balanceChanges === null) {
    lines.push('Balance changes: unknown (simulation unavailable)', '');
  } else if (view.balanceChanges.length === 0) {
    // Lower levels only list the user's wallets: say so, so "none" never reads as "nothing moves".
    lines.push(expert ? 'Balance changes: none' : 'Balance changes for your wallets: none', '');
  } else {
    lines.push(expert ? 'Balance changes:' : 'Balance changes for your wallets:');
    for (const c of view.balanceChanges) lines.push(`  ${clean(c.amount)} ${clean(c.asset)}${expert ? `  (${clean(c.owner)})` : ''}`);
    lines.push('');
  }

  if (view.level === 'basic') return lines.join('\n').trimEnd();

  if (view.level === 'expert') {
    lines.push(`Version: ${clean(view.version)}`, `Fee payer: ${clean(view.feePayer)}`, `Blockhash: ${clean(view.recentBlockhash)}`);
    if (view.computeUnitLimit !== undefined) lines.push(`Compute unit limit: ${clean(view.computeUnitLimit)}`);
    if (view.computeUnitPrice !== undefined) lines.push(`Compute unit price: ${clean(view.computeUnitPrice)} micro-lamports`);
    lines.push('');
  }

  for (const ix of view.instructions) {
    lines.push(`#${ix.index + 1} ${clean(ix.program)} - ${clean(ix.name)}${ix.trust ? ` [${clean(ix.trust)}]` : ''}`);
    if ('programId' in ix) lines.push(`    program id: ${clean(ix.programId)}`);
    for (const [k, v] of Object.entries(ix.args)) lines.push(`    ${clean(k)}: ${clean(v)}`);
    for (const a of ix.accounts) {
      const flags = 'signer' in a ? ` ${a.signer ? 's' : '-'}${a.writable ? 'w' : '-'}${a.lookupTable ? ` (ALT ${clean(a.lookupTable)})` : ''}` : '';
      const badges = a.badges.length ? `  ${a.badges.map(clean).join('  ')}` : '';
      lines.push(`    ${clean(a.name)}: ${a.label ? `${clean(a.label)} ` : ''}${clean(a.address)}${flags}${badges}`);
    }
    if ('dataHex' in ix) {
      lines.push(`    data: ${clean(ix.dataHex) || '(empty)'}`);
      if (ix.idl) lines.push(`    idl: ${clean(ix.idl.source)} (${clean(ix.idl.trust)}) ${clean(ix.idl.hash).slice(0, 12)}`);
    }
    lines.push('');
  }

  if (view.level === 'expert') {
    if (view.stateChanges === null) {
      lines.push('State changes: unknown (no simulation)', '');
    } else if (view.stateChanges.length) {
      lines.push('State changes:');
      for (const s of view.stateChanges) {
        const extra = [
          s.holder !== undefined && `holder ${clean(s.holder)}`,
          s.balance !== undefined && `balance ${clean(s.balance)}`,
          s.amount !== undefined && `delegated ${clean(s.amount)}`,
        ].filter(Boolean);
        lines.push(`  ${clean(s.kind)} ${clean(s.address)}: ${clean(s.before ?? 'none')} -> ${clean(s.after ?? 'none')}${extra.length ? `  (${extra.join(', ')})` : ''}`);
      }
      lines.push('');
    }
    if (view.relations.length) {
      lines.push('Relations:');
      for (const r of view.relations) {
        const at = r.instructionIndex === undefined ? '' : ` #${r.instructionIndex + 1}`;
        lines.push(`  ${RELATION[r.status] ?? '?'} ${clean(r.kind)}${at} ${clean(r.label)}: ${clean(r.from)} -> ${clean(r.to)}${r.detail ? `  (${clean(r.detail)})` : ''}`);
      }
      lines.push('');
    }
    if (view.issues.length) {
      lines.push('Issues:');
      for (const i of view.issues) lines.push(`  [${clean(i.stage)}]${i.instructionIndex === undefined ? '' : ` #${i.instructionIndex + 1}`} ${clean(i.message)}`);
    }
  }
  return lines.join('\n').trimEnd();
}
