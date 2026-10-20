import { chainFor, type Settings } from '@clef/wallet-core';

export type ClusterName = 'mainnet' | 'devnet' | 'localnet';

const CLUSTER_LABEL: Record<ClusterName, string> = { mainnet: 'Mainnet', devnet: 'Devnet', localnet: 'Localnet' };

/** The cluster the wallet is on: a custom RPC counts as the cluster it serves. */
export const clusterOf = (s: Pick<Settings, 'network' | 'customCluster'>): ClusterName => clusterOfChain(chainFor(s));

/** 'solana:devnet' -> 'devnet'; anything unknown counts as a test network, never as mainnet. */
export function clusterOfChain(chain: string): ClusterName {
  const c = chain.replace(/^solana:/, '');
  return c === 'mainnet' || c === 'devnet' ? c : 'localnet';
}

export const clusterLabel = (c: ClusterName) => CLUSTER_LABEL[c];

/** 'Mainnet', 'Devnet', 'Localnet', or 'Mainnet · custom RPC' / 'Devnet · custom RPC'. */
export function networkLabel(s: Pick<Settings, 'network' | 'customCluster'>): string {
  const name = CLUSTER_LABEL[clusterOf(s)];
  return s.network === 'custom' ? `${name} · custom RPC` : name;
}

/** The Solana Explorer page for a transaction; null on localnet, which no public explorer sees. */
export function explorerUrl(s: Pick<Settings, 'network' | 'customCluster'>, signature: string): string | null {
  const cluster = clusterOf(s);
  if (cluster === 'localnet') return null;
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}
