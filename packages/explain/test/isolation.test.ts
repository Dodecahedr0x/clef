import { createBundledSource, IdlResolver } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { createNoopSigner } from '@solana/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { explain } from '../src';
import { buildWire, ME, OTHER } from './helpers';

/** Which internal stage to break. Mocked modules throw while their flag is set. */
const broken = vi.hoisted(() => ({ pda: false, risk: false, summary: false }));

vi.mock('../src/pda', async (original) => {
  const mod = await original<typeof import('../src/pda')>();
  return { ...mod, verifyCodamaPdas: async (...args: Parameters<typeof mod.verifyCodamaPdas>) => {
    if (broken.pda) throw new Error('pda boom');
    return mod.verifyCodamaPdas(...args);
  } };
});
vi.mock('../src/risk', async (original) => {
  const mod = await original<typeof import('../src/risk')>();
  return { ...mod, evaluateRisks: (...args: Parameters<typeof mod.evaluateRisks>) => {
    if (broken.risk) throw new Error('risk boom');
    return mod.evaluateRisks(...args);
  } };
});
vi.mock('../src/summary', async (original) => {
  const mod = await original<typeof import('../src/summary')>();
  return { ...mod, summarize: (...args: Parameters<typeof mod.summarize>) => {
    if (broken.summary) throw new Error('summary boom');
    return mod.summarize(...args);
  } };
});

afterEach(() => Object.assign(broken, { pda: false, risk: false, summary: false }));

const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1n })]);
const run = (reader = new MemoryChainReader()) => explain({ wire }, { reader, idls: new IdlResolver([createBundledSource()]), me: [ME] });

describe('explain isolates failing stages', () => {
  it('turns a throwing relation check into an issue', async () => {
    broken.pda = true;
    const ex = await run();
    expect(ex.issues).toContainEqual({ stage: 'relations', instructionIndex: 0, message: 'pda boom' });
    expect(ex.instructions[0]!.name).toBe('transferSol');
  });

  it('fails closed when the risk rules throw', async () => {
    broken.risk = true;
    const ex = await run();
    expect(ex.warnings).toEqual([{ rule: 'internal-error', severity: 'danger', message: 'Clef could not finish its safety checks.' }]);
    expect(ex.summary).toBe('Send 0.000000001 SOL to 7xKX\u2026gAsU -- Clef could not finish its safety checks');
  });

  it('falls back to a plain summary when summarizing throws', async () => {
    broken.summary = true;
    expect((await run()).summary).toBe('Interact with System Program');
    broken.risk = true;
    expect((await run()).summary).toBe('Interact with System Program -- Clef could not finish its safety checks.');
  });

  it('survives a reader whose simulate or getAccounts throws', async () => {
    const reader = new MemoryChainReader();
    reader.simulateImpl = async () => {
      throw new Error('rpc down');
    };
    const ex = await run(reader);
    expect(ex.issues).toContainEqual({ stage: 'simulate', message: 'Simulation unavailable: rpc down' });
    expect(ex.balanceChanges).toBeNull();

    const dead = new MemoryChainReader();
    dead.getAccounts = async () => {
      throw new Error('rpc down');
    };
    const ex2 = await run(dead);
    expect(ex2.issues).toContainEqual({ stage: 'decode', message: 'Could not load accounts: rpc down' });
    expect(ex2.issues).toContainEqual({ stage: 'simulate', message: 'Simulation skipped: pre-transaction state unavailable' });
    expect(ex2.warnings.map((w) => w.rule)).toContain('simulation-failed');
  });
});
