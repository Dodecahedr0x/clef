import { MemoryStore } from '@clef/vault';
import { describe, expect, it } from 'vitest';
import { chainFor, DEFAULT_RPC, DEFAULT_SETTINGS, SettingsStore } from '../src/settings';

describe('Settings v2', () => {
  it('has the pinned defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      network: 'mainnet',
      rpcUrl: DEFAULT_RPC.mainnet,
      customCluster: 'mainnet',
      autoLockMinutes: 15,
      detailLevel: 'intermediate',
      hideSpam: true,
      networkSwitchInHeader: true,
      devnetTint: true,
      jupiterApiKey: null,
      errorReports: false,
    });
    expect(DEFAULT_RPC.localnet).toBe('http://127.0.0.1:8899');
    // api.mainnet-beta.solana.com answers browser requests with 403
    expect(DEFAULT_RPC.mainnet).toBe('https://solana-rpc.publicnode.com');
  });

  it('moves mainnet off the browser-blocked official endpoint, keeping custom URLs', async () => {
    const local = new MemoryStore();
    await local.set('settings', { network: 'mainnet', rpcUrl: 'https://api.mainnet-beta.solana.com/' });
    expect(await new SettingsStore(local).get()).toMatchObject({ network: 'mainnet', rpcUrl: DEFAULT_RPC.mainnet });
    await local.set('settings', { network: 'custom', rpcUrl: 'https://api.mainnet-beta.solana.com', customCluster: 'mainnet' });
    expect(await new SettingsStore(local).get()).toMatchObject({ network: 'custom', rpcUrl: 'https://api.mainnet-beta.solana.com' });
  });

  it('migrates an M2-shaped stored object by filling defaults', async () => {
    const local = new MemoryStore();
    await local.set('settings', { network: 'devnet', rpcUrl: 'https://my.devnet.rpc', autoLockMinutes: 5 });
    const s = await new SettingsStore(local).get();
    expect(s).toEqual({ ...DEFAULT_SETTINGS, network: 'devnet', rpcUrl: 'https://my.devnet.rpc', autoLockMinutes: 5 });
  });

  it('migrates an M2 loopback http RPC to localnet', async () => {
    const local = new MemoryStore();
    await local.set('settings', { network: 'mainnet', rpcUrl: 'http://127.0.0.1:8899', autoLockMinutes: 15 });
    expect(await new SettingsStore(local).get()).toMatchObject({ network: 'localnet', rpcUrl: 'http://127.0.0.1:8899' });
  });

  it('chainFor maps networks, custom by its cluster', () => {
    expect(chainFor({ network: 'mainnet', customCluster: 'devnet' })).toBe('solana:mainnet');
    expect(chainFor({ network: 'devnet', customCluster: 'mainnet' })).toBe('solana:devnet');
    expect(chainFor({ network: 'localnet', customCluster: 'mainnet' })).toBe('solana:localnet');
    expect(chainFor({ network: 'custom', customCluster: 'devnet' })).toBe('solana:devnet');
  });

  it('localnet allows loopback http; custom requires https', async () => {
    const s = new SettingsStore(new MemoryStore());
    expect(await s.update({ network: 'localnet' })).toMatchObject({ rpcUrl: 'http://127.0.0.1:8899' });
    expect(await s.update({ network: 'localnet', rpcUrl: 'http://localhost:9000' })).toMatchObject({ rpcUrl: 'http://localhost:9000' });
    await expect(s.update({ network: 'localnet', rpcUrl: 'http://10.0.0.2:8899' })).rejects.toThrow(/https/);
    await expect(s.update({ network: 'custom', rpcUrl: 'http://127.0.0.1:8899' })).rejects.toThrow(/https/);
    await expect(s.update({ network: 'custom', rpcUrl: 'http://rpc.example.com' })).rejects.toThrow(/https/);
    expect(await s.update({ network: 'custom', rpcUrl: 'https://rpc.example.com', customCluster: 'devnet' })).toMatchObject({ network: 'custom', customCluster: 'devnet' });
    await expect(s.update({ network: 'mainnet', rpcUrl: 'http://127.0.0.1:8899' })).rejects.toThrow(/https/);
  });

  it('validates the new fields', async () => {
    const s = new SettingsStore(new MemoryStore());
    expect(await s.update({ detailLevel: 'expert', hideSpam: false, devnetTint: false, networkSwitchInHeader: false, errorReports: true, jupiterApiKey: ' abc-123 ' })).toMatchObject({
      detailLevel: 'expert',
      hideSpam: false,
      errorReports: true,
      jupiterApiKey: 'abc-123',
    });
    expect(await s.update({ jupiterApiKey: '' })).toMatchObject({ jupiterApiKey: null });
    await expect(s.update({ detailLevel: 'pro' as never })).rejects.toThrow();
    await expect(s.update({ hideSpam: 'yes' as never })).rejects.toThrow();
    await expect(s.update({ customCluster: 'testnet' as never })).rejects.toThrow();
    await expect(s.update({ jupiterApiKey: 'x'.repeat(200) })).rejects.toThrow();
    await expect(s.update({ jupiterApiKey: 'bad key!' })).rejects.toThrow();
  });
});
