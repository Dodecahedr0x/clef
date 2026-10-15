import { describe, expect, it } from 'vitest';
import { parseCli, USAGE } from '../src/args';

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

describe('parseCli', () => {
  it('rejects missing or unknown commands with usage', () => {
    for (const argv of [[], ['explain'], ['nope', 'sig'], ['explain', 'sig', '--level', 'max'], ['explain', 'sig', '--bogus'], ['explain', 'sig', '--tx', 'AA==']]) {
      expect(parseCli(argv, {})).toMatchObject({ usage: true });
    }
  });

  it('parses a signature with defaults', () => {
    expect(parseCli(['explain', 'SIG'], {})).toEqual({
      signature: 'SIG', level: 'intermediate', me: [], labels: {}, rpc: 'https://api.mainnet-beta.solana.com',
    });
    expect(parseCli(['explain', 'SIG'], { CLEF_RPC: 'http://x' })).toMatchObject({ rpc: 'http://x' });
    expect(parseCli(['explain', 'SIG', '--rpc', 'http://y'], { CLEF_RPC: 'http://x' })).toMatchObject({ rpc: 'http://y' });
  });

  it('takes repeated --me and --label', () => {
    const parsed = parseCli(['explain', '--tx', 'AA==', '--me', WALLET, '--me', OTHER, '--label', `${OTHER}=Jupiter v6`, '--level', 'expert', '--record', 'f.json'], {});
    expect(parsed).toEqual({
      tx: 'AA==', level: 'expert', me: [WALLET, OTHER], labels: { [OTHER]: 'Jupiter v6' }, rpc: 'https://api.mainnet-beta.solana.com', record: 'f.json',
    });
  });

  it('rejects bad addresses and labels', () => {
    expect(parseCli(['explain', 'S', '--me', 'not-an-address'], {})).toMatchObject({ error: expect.stringContaining('--me') });
    expect(parseCli(['explain', 'S', '--label', 'nolabel'], {})).toMatchObject({ error: expect.stringContaining('--label') });
    expect(parseCli(['explain', 'S', '--label', `${WALLET}=`], {})).toMatchObject({ error: expect.stringContaining('--label') });
  });

  it('sanitizes label names', () => {
    const parsed = parseCli(['explain', 'S', '--label', `${WALLET}=Al\u001b[31mice\u202e`], {});
    expect(parsed).toMatchObject({ labels: { [WALLET]: 'Al[31mice' } });
  });

  it('documents exit codes', () => {
    expect(USAGE).toContain('3');
    expect(USAGE).toContain('CLEF_RPC');
  });
});
