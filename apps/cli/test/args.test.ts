import { describe, expect, it } from 'vitest';
import { parseCli, USAGE } from '../src/args';

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SIG = '2h8s8iiZHA4xCDrhUZsue2sDtZEs8mZ19b9ryRoEhNoB9biNMHieKk4nknY4vuLbAAkTS3H7uV8sUScgfPY86geE';

describe('parseCli', () => {
  it('rejects missing or unknown commands with usage', () => {
    for (const argv of [[], ['explain'], ['nope', 'sig'], ['explain', SIG, '--level', 'max'], ['explain', SIG, '--bogus'], ['explain', SIG, '--tx', 'AA==']]) {
      expect(parseCli(argv, {})).toMatchObject({ usage: true });
    }
  });

  it('parses a signature with defaults', () => {
    expect(parseCli(['explain', SIG], {})).toEqual({
      signature: SIG, level: 'intermediate', me: [], labels: {}, rpc: 'https://api.mainnet-beta.solana.com',
    });
    expect(parseCli(['explain', SIG], { CLEF_RPC: 'http://x' })).toMatchObject({ rpc: 'http://x' });
    expect(parseCli(['explain', SIG, '--rpc', 'http://y'], { CLEF_RPC: 'http://x' })).toMatchObject({ rpc: 'http://y' });
  });

  it('takes repeated --me and --label', () => {
    const parsed = parseCli(['explain', '--tx', 'AA==', '--me', WALLET, '--me', OTHER, '--label', `${OTHER}=Jupiter v6`, '--level', 'expert', '--record', 'f.json'], {});
    expect(parsed).toEqual({
      tx: 'AA==', level: 'expert', me: [WALLET, OTHER], labels: { [OTHER]: 'Jupiter v6' }, rpc: 'https://api.mainnet-beta.solana.com', record: 'f.json',
    });
  });

  it('rejects bad addresses and labels', () => {
    expect(parseCli(['explain', SIG, '--me', 'not-an-address'], {})).toMatchObject({ error: expect.stringContaining('--me') });
    expect(parseCli(['explain', SIG, '--label', 'nolabel'], {})).toMatchObject({ error: expect.stringContaining('--label') });
    expect(parseCli(['explain', SIG, '--label', `${WALLET}=`], {})).toMatchObject({ error: expect.stringContaining('--label') });
  });

  it('sanitizes label names', () => {
    const parsed = parseCli(['explain', SIG, '--label', `${WALLET}=Al\u001b[31mice\u202e`], {});
    expect(parsed).toMatchObject({ labels: { [WALLET]: 'Al[31mice' } });
  });

  it('rejects malformed signatures and transactions', () => {
    // Not base58, or not 64 bytes.
    for (const sig of ['SIG', '0OIl', WALLET, `${SIG}x`]) expect(parseCli(['explain', sig], {}), sig).toMatchObject({ usage: true });
    for (const tx of ['!!!', 'A', 'AAA', 'AA=A', ' AA==', '']) expect(parseCli(['explain', '--tx', tx], {}), tx).toMatchObject({ usage: true });
    expect(parseCli(['explain', '--tx', 'AAAA'], {})).toMatchObject({ tx: 'AAAA' });
  });

  it('documents exit codes and the RPC default', () => {
    expect(USAGE).toMatch(/^  3  explained, and at least one DANGER warning$/m);
    expect(USAGE).toMatch(/^  2  usage error/m);
    expect(USAGE).toMatch(/^  1  error/m);
    expect(USAGE).toMatch(/^  0  explained, no danger$/m);
    expect(USAGE).toContain('$CLEF_RPC');
    expect(USAGE).toContain('assumes you are the fee payer');
    expect(USAGE).toContain('For sponsored/gasless transactions the fee payer is not you: pass --me.');
  });
});
