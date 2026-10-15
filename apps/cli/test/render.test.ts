import { describe, expect, it } from 'vitest';
import type { BasicView, ExpertView, IntermediateView } from '@clef/explain';
import { clean, hasDanger, renderView } from '../src/render';

const intermediate: IntermediateView = {
  level: 'intermediate',
  summary: 'Send 1.5 SOL to Alice',
  warnings: [{ rule: 'durable-nonce', severity: 'warn', message: 'Uses a durable nonce.' }],
  balanceChanges: [{ owner: 'me', asset: 'SOL', amount: '-1.5' }],
  instructions: [{
    index: 1, program: 'System Program', name: 'transferSol', trust: 'curated', args: { amount: '1.5 SOL' },
    accounts: [{ name: 'source', address: 'AAAA', label: 'Your wallet', badges: [] }, { name: 'destination', address: 'BBBB', badges: ['PDA("x") \u2713'] }],
  }],
};

const expert: ExpertView = {
  level: 'expert',
  summary: 'Send 1.5 SOL to Alice',
  warnings: [],
  balanceChanges: [{ owner: 'AAAA', asset: 'SOL', amount: '-1.500005' }, { owner: 'BBBB', asset: 'SOL', amount: '+1.5' }],
  fee: '0.000005 SOL',
  version: '0',
  feePayer: 'AAAA',
  recentBlockhash: 'H',
  computeUnitLimit: 200000,
  computeUnitPrice: '1000',
  relations: [{ kind: 'pda', from: 'BBBB' as never, to: 'PPPP' as never, label: 'PDA("x")', status: 'mismatch', detail: 'expected CCCC' }],
  issues: [{ stage: 'idl', message: 'boom' }],
  stateChanges: [{ address: 'TTTT', kind: 'token-delegate', before: null, after: 'DDDD', amount: '100', holder: 'AAAA', balance: '100' }],
  instructions: [{
    index: 0, program: 'System Program', programId: '11111111111111111111111111111111', name: 'transferSol', trust: 'curated',
    idl: { source: 'bundled', trust: 'curated', hash: '0123456789abcdef' }, dataHex: '02000000', args: { amount: '1.5 SOL' },
    accounts: [
      { name: 'source', address: 'AAAA', label: 'Your wallet', badges: [], signer: true, writable: true },
      { name: 'destination', address: 'BBBB', badges: [], signer: false, writable: true, lookupTable: 'LLLL' },
    ],
  }],
};

describe('renderView', () => {
  it('renders summary, warnings, changes and instructions', () => {
    expect(renderView(intermediate)).toMatchInlineSnapshot(`
      "Send 1.5 SOL to Alice

      Warning: Uses a durable nonce.

      Balance changes for your wallets:
        -1.5 SOL

      #2 System Program - transferSol [curated]
          amount: 1.5 SOL
          source: Your wallet AAAA
          destination: BBBB  PDA("x") \u2713"
    `);
  });

  it('renders expert-only sections', () => {
    const out = renderView(expert);
    expect(out).toMatchInlineSnapshot(`
      "Send 1.5 SOL to Alice

      Network fee: 0.000005 SOL

      Balance changes:
        -1.500005 SOL  (AAAA)
        +1.5 SOL  (BBBB)

      Version: 0
      Fee payer: AAAA
      Blockhash: H
      Compute unit limit: 200000
      Compute unit price: 1000 micro-lamports

      #1 System Program - transferSol [curated]
          program id: 11111111111111111111111111111111
          amount: 1.5 SOL
          source: Your wallet AAAA sw
          destination: BBBB -w (ALT LLLL)
          data: 02000000
          idl: bundled (curated) 0123456789ab

      State changes:
        token-delegate TTTT: none -> DDDD  (holder AAAA, balance 100, delegated 100)

      Relations:
        \u2717 MISMATCH pda PDA("x"): BBBB -> PPPP  (expected CCCC)

      Issues:
        [idl] boom"
    `);
    expect(out).toContain('Fee payer: AAAA');
    expect(out).toContain('Compute unit limit: 200000');
    expect(out).toContain('Compute unit price: 1000 micro-lamports');
    expect(out).toContain('Network fee: 0.000005 SOL');
    expect(out).toContain('[idl] boom');
    expect(out).toContain('data: 02000000');
    expect(out).toContain('token-delegate TTTT');
    // Expert-only sections never appear at lower levels.
    const lower = renderView(intermediate);
    for (const s of ['Fee payer', 'Blockhash', 'Issues:', 'State changes', 'Relations:', 'data:']) expect(lower).not.toContain(s);
  });

  it('says when an expert fee or state changes are unknown', () => {
    const out = renderView({ ...expert, fee: null, stateChanges: null });
    expect(out).toContain('Network fee: unknown');
    expect(out).toContain('State changes: unknown');    expect(renderView({ ...expert, stateChanges: [] })).toContain('State changes: none');
  });

  it('renders unknown balance changes as unknown, never as an empty list', () => {
    for (const view of [{ ...intermediate, balanceChanges: null }, { ...expert, balanceChanges: null }]) {
      const out = renderView(view);
      expect(out).toContain('Balance changes: unknown (simulation unavailable)');
      expect(out).not.toMatch(/Balance changes.*none/);
    }
  });

  it('distinguishes "none for your wallets" from unknown', () => {
    expect(renderView({ ...intermediate, balanceChanges: [] })).toContain('Balance changes for your wallets: none');
    expect(renderView({ ...expert, balanceChanges: [] })).toContain('Balance changes: none');
  });

  it('puts dangers first, then warnings, then info', () => {
    const basic: BasicView = {
      level: 'basic',
      summary: 'S',
      balanceChanges: [],
      warnings: [
        { rule: 'a', severity: 'info', message: 'info one' },
        { rule: 'b', severity: 'warn', message: 'warn one' },
        { rule: 'c', severity: 'danger', message: 'danger one' },
        { rule: 'd', severity: 'info', message: 'info two' },
        { rule: 'e', severity: 'danger', message: 'danger two' },
      ],
    };
    const out = renderView(basic);
    const order = ['danger one', 'danger two', 'warn one', 'info one', 'info two'].map((m) => out.indexOf(m));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out.split('\n')[0]).toMatch(/^!+ DANGER/);
    expect(out).toContain('DANGER: danger one');
    expect(hasDanger(basic)).toBe(true);
    expect(hasDanger(intermediate)).toBe(false);
  });

  it('shows the fee at lower levels only when the view carries one (high-fee)', () => {
    expect(renderView(intermediate)).not.toContain('Network fee');
    expect(renderView({ ...intermediate, fee: '0.2 SOL' })).toContain('Network fee: 0.2 SOL');
  });

  it('strips terminal escapes and bidi controls from every string', () => {
    const evil = 'a\u001b[2J\u001b]0;pwned\u0007b\u009b31m\u202ec\u2066d\r\ne';
    const view: ExpertView = {
      ...expert,
      summary: evil,
      warnings: [{ rule: evil, severity: 'danger', message: evil }],
      balanceChanges: [{ owner: evil, asset: evil, amount: evil }],
      fee: evil,
      version: evil,
      feePayer: evil,
      recentBlockhash: evil,
      computeUnitPrice: evil,
      relations: [{ ...expert.relations[0]!, from: evil as never, to: evil as never, label: evil, detail: evil }],
      issues: [{ stage: evil as never, message: evil }],
      stateChanges: [{ address: evil, kind: evil, before: evil, after: evil, amount: evil, holder: evil, balance: evil }],
      instructions: [{
        ...expert.instructions[0]!, program: evil, name: evil, trust: evil, dataHex: evil, args: { [evil]: evil },
        idl: { source: evil, trust: evil, hash: evil },
        accounts: [{ name: evil, address: evil, label: evil, badges: [evil], signer: true, writable: false, lookupTable: evil }],
      }],
    };
    const out = renderView(view);
    expect(out).toContain('a[2J]0;pwnedb31mcde');
    // Only printable characters and newlines (between lines we produce) survive.
    expect(out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069]/);
    expect(out).not.toContain('\re');
    expect(clean('x\u001b[31my')).toBe('x[31my');
  });

  it('strips invisible format characters, Hangul fillers and variation selectors', () => {
    const chars = ['\u00ad', '\u180e', '\ufeff', '\u2060', '\u2063', '\u{e0041}', '\u115f', '\u1160', '\u3164', '\uffa0', '\ufe00', '\ufe0f', '\u{e0100}', '\u{e01ef}', '\ud800'];
    for (const c of chars) {
      const out = renderView({ level: 'basic', summary: `a${c}b`, warnings: [{ rule: 'r', severity: 'warn', message: `m${c}n` }], balanceChanges: [] });
      expect(out, `U+${c.codePointAt(0)!.toString(16)}`).toContain('ab');
      expect(out).toContain('Warning: mn');
      expect(out).not.toContain(c);
    }
  });
});
