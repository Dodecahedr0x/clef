import type { ChainReader } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { decodeMultisig, decodeProposal, decodeVaultTransaction, isAccount, type MultisigInfo, type ProposalStatus } from './accounts';
import { vaultMessageToV0 } from './message';
import { proposalPda, SQUADS_PROGRAM_ID, transactionPda } from './pda';

export * from './pda';
export { decodeMultisig, decodeProgramConfig, decodeProposal, decodeVaultTransaction } from './accounts';
export type { Member, MultisigInfo, ProposalStatus, VaultMessage } from './accounts';
export { encodeTransactionMessage, vaultMessageFromWire, vaultMessageToV0 } from './message';
export { buildExecuteTransaction, buildProposeTransaction, buildProposeTransactions, buildVoteTransaction } from './transactions';

export type ProposalInfo = { index: bigint; status: ProposalStatus; approved: Address[]; rejected: Address[]; cancelled: Address[]; transaction: Address; innerMessage: Uint8Array | null };

export async function fetchMultisig(chain: ChainReader, multisig: Address): Promise<MultisigInfo | null> {
  const [account] = await chain.getAccounts([multisig]);
  if (!account || account.owner !== SQUADS_PROGRAM_ID || !isAccount(account.data, 'multisig')) return null;
  return decodeMultisig(multisig, account.data);
}

/** Newest first, over `staleTransactionIndex+1..transactionIndex`; indices without a proposal account are skipped. */
export async function listProposals(chain: ChainReader, multisig: Address, opts: { limit: number }): Promise<ProposalInfo[]> {
  const info = await fetchMultisig(chain, multisig);
  if (!info) return [];
  const indices: bigint[] = [];
  for (let i = info.transactionIndex; i > info.staleTransactionIndex && indices.length < opts.limit; i--) indices.push(i);
  if (indices.length === 0) return [];

  const pdas = await Promise.all(indices.map(async (i) => [await proposalPda(multisig, i), await transactionPda(multisig, i)] as const));
  const accounts = await chain.getAccounts(pdas.flat());
  const ours = (j: number) => {
    const acc = accounts[j];
    return acc && acc.owner === SQUADS_PROGRAM_ID ? acc.data : null;
  };

  const out: ProposalInfo[] = [];
  indices.forEach((index, n) => {
    const proposalData = ours(2 * n);
    if (!proposalData || !isAccount(proposalData, 'proposal')) return;
    const proposal = decodeProposal(proposalData);
    if (proposal.multisig !== multisig || proposal.index !== index) return;
    const txData = ours(2 * n + 1);
    let innerMessage: Uint8Array | null = null;
    if (txData && isAccount(txData, 'vaultTransaction')) {
      const vt = decodeVaultTransaction(txData);
      if (vt.multisig === multisig) innerMessage = vaultMessageToV0(vt.message);
    }
    const { status, approved, rejected, cancelled } = proposal;
    out.push({ index, status, approved, rejected, cancelled, transaction: pdas[n]![1], innerMessage });
  });
  return out;
}
