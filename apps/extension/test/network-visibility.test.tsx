// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NetworkChip, NetworkEdge } from '../components';
import { clusterOf, clusterOfChain, networkLabel } from '../lib/network';

afterEach(cleanup);

describe('network helpers', () => {
  it('a custom RPC counts as the cluster it serves', () => {
    expect(clusterOf({ network: 'mainnet', customCluster: 'devnet' })).toBe('mainnet');
    expect(clusterOf({ network: 'custom', customCluster: 'devnet' })).toBe('devnet');
    expect(clusterOf({ network: 'custom', customCluster: 'mainnet' })).toBe('mainnet');
    expect(clusterOf({ network: 'localnet', customCluster: 'mainnet' })).toBe('localnet');
  });

  it('labels name the cluster, and say when the RPC is custom', () => {
    expect(networkLabel({ network: 'devnet', customCluster: 'mainnet' })).toBe('Devnet');
    expect(networkLabel({ network: 'custom', customCluster: 'mainnet' })).toBe('Mainnet · custom RPC');
    expect(networkLabel({ network: 'custom', customCluster: 'devnet' })).toBe('Devnet · custom RPC');
  });

  it('an unknown chain never counts as mainnet', () => {
    expect(clusterOfChain('solana:mainnet')).toBe('mainnet');
    expect(clusterOfChain('solana:devnet')).toBe('devnet');
    expect(clusterOfChain('solana:testnet')).toBe('localnet');
  });
});

describe('NetworkEdge', () => {
  it('shows nothing on mainnet', () => {
    render(<NetworkEdge cluster="mainnet" tint />);
    expect(screen.queryByTestId('network-edge')).toBeNull();
  });

  it('names a test network, with the amber edge while the tint is on', () => {
    const { container, rerender } = render(<NetworkEdge cluster="devnet" tint />);
    expect(screen.getByRole('note', { name: 'Test network: Devnet' }).textContent).toBe('Devnet');
    expect(container.querySelector('.bg-warn.h-\\[3px\\]')).not.toBeNull();
    rerender(<NetworkEdge cluster="localnet" tint={false} />);
    // Tint off: the name stays, the edge goes.
    expect(screen.getByRole('note', { name: 'Test network: Localnet' })).toBeTruthy();
    expect(container.querySelector('.h-\\[3px\\]')).toBeNull();
  });
});

describe('NetworkChip', () => {
  it('names the network, read-only', () => {
    const { rerender } = render(<NetworkChip cluster="devnet" />);
    expect(screen.getByRole('img', { name: 'Network: Devnet' }).textContent).toBe('Devnet');
    rerender(<NetworkChip cluster="mainnet" />);
    expect(screen.getByRole('img', { name: 'Network: Mainnet' }).textContent).toBe('Mainnet');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});
