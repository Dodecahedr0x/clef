import { describe, expect, it } from 'vitest';
import { parseLogs } from '../src/logs';
import { ATA_PROGRAM, TOKEN_PROGRAM } from '../src/registry';

describe('parseLogs', () => {
  it('tracks nested depth, consumed CU and success', () => {
    const out = parseLogs([
      `Program ${ATA_PROGRAM} invoke [1]`,
      'Program log: CreateIdempotent',
      `Program ${TOKEN_PROGRAM} invoke [2]`,
      'Program log: Instruction: GetAccountDataSize',
      `Program ${TOKEN_PROGRAM} consumed 1622 of 194659 compute units`,
      `Program ${TOKEN_PROGRAM} success`,
      `Program ${ATA_PROGRAM} consumed 12906 of 199850 compute units`,
      `Program ${ATA_PROGRAM} success`,
    ]);
    expect(out.map((l) => [l.kind, l.depth])).toEqual([
      ['invoke', 0],
      ['log', 1],
      ['invoke', 1],
      ['log', 2],
      ['consumed', 2],
      ['success', 1],
      ['consumed', 1],
      ['success', 0],
    ]);
    expect(out[0]).toMatchObject({ programId: ATA_PROGRAM, programName: 'Associated Token Program' });
    expect(out[6]?.computeUnits).toEqual({ consumed: 12906, budget: 199850 });
    expect(out[6]?.programId).toBe(ATA_PROGRAM);
    expect(out[1]?.programId).toBeUndefined();
  });

  it('handles failed, data, return and other kinds', () => {
    const out = parseLogs([
      `Program ${TOKEN_PROGRAM} invoke [1]`,
      'Program data: AQID',
      `Program return: ${TOKEN_PROGRAM} AQID`,
      'Log truncated',
      `Program ${TOKEN_PROGRAM} failed: custom program error: 0x1`,
      'Program log: after',
    ]);
    expect(out.map((l) => [l.kind, l.depth])).toEqual([
      ['invoke', 0],
      ['data', 1],
      ['return', 1],
      ['other', 1],
      ['failed', 0],
      ['log', 0],
    ]);
    expect(out[2]?.programId).toBe(TOKEN_PROGRAM);
    expect(out[4]?.programId).toBe(TOKEN_PROGRAM);
  });

  it('leaves unknown names unset, skips invalid ids and never goes below depth 0', () => {
    const out = parseLogs(['Program notanaddress success', 'Program 11111111111111111111111111111112 invoke [1]']);
    expect(out[0]).toMatchObject({ kind: 'success', depth: 0 });
    expect(out[0]?.programId).toBeUndefined();
    expect(out[1]?.programId).toBe('11111111111111111111111111111112');
    expect(out[1]?.programName).toBeUndefined();
  });

  it('sanitizes attacker-controlled text', () => {
    const out = parseLogs([`Program log: evil‮\u0007${'x'.repeat(1000)}`]);
    expect(out[0]?.text).not.toMatch(/[‮\u0007]/);
    expect(Array.from(out[0]?.text ?? '').length).toBe(512);
  });
});
