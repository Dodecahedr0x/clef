import { describe, expect, it } from 'vitest';
import { loadErrorText, rpcHost, sendErrorText } from '../lib/error-text';

const RPC = 'https://api.mainnet-beta.solana.com';

describe('sendErrorText', () => {
  it('a rejection is a cancel, by code or by message', () => {
    expect(sendErrorText(Object.assign(new Error('nope'), { code: 4001 }))).toEqual({ tone: 'neutral', title: 'Cancelled. Nothing was sent.' });
    expect(sendErrorText(new Error('User rejected the request')).tone).toBe('neutral');
  });

  it.each([
    ['Account cannot sign', "This account can't sign"],
    ['Transaction results in an account (1) with insufficient funds for rent', 'Not enough SOL for the account minimum'],
    ['Attempt to debit an account but found no record of a prior credit.', 'Not enough SOL for this transaction'],
    ['custom program error: 0x1771', 'The price moved'],
    ['Blockhash not found', 'Took too long'],
    ['Transaction simulation failed: Error processing Instruction 0', 'The network rejected this transaction'],
    ['something odd', "Clef couldn't send this transaction"],
  ])('%s -> %s', (raw, title) => {
    const t = sendErrorText(new Error(raw), { rpcUrl: RPC });
    expect(t.title).toBe(title);
    expect(t.tone).toBe('danger');
  });

  it('a connection failure names the RPC host and points at the RPC settings', () => {
    const t = sendErrorText(new Error('Failed to fetch'), { rpcUrl: RPC });
    expect(t).toMatchObject({ title: "Couldn't reach api.mainnet-beta.solana.com", rpc: true, detail: 'Failed to fetch' });
  });

  it('slippage names the setting', () => {
    expect(sendErrorText(new Error('SlippageToleranceExceeded'), { slippageBps: 50 }).body).toMatch(/your 0\.5% slippage/);
  });
});

describe('loadErrorText', () => {
  it('a 403 is a connection problem, with funds safe', () => {
    expect(loadErrorText('HTTP error (403): Forbidden', RPC)).toMatchObject({ title: "Couldn't reach api.mainnet-beta.solana.com", rpc: true });
  });
  it('anything else is a plain load failure', () => {
    expect(loadErrorText('bad data').title).toBe("Couldn't load this");
  });
});

it('rpcHost falls back for a missing or bad URL', () => {
  expect(rpcHost(undefined)).toBe('your RPC');
  expect(rpcHost('not a url')).toBe('your RPC');
});
