import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { multisigPda, proposalPda, SQUADS_PROGRAM_ID, transactionPda, vaultPda } from '../src';
import { MULTISIG } from './helpers';

// Vectors computed with @sqds/multisig@2.1.4 (getMultisigPda/getVaultPda/getTransactionPda/getProposalPda).
describe('Squads v4 PDAs', () => {
  it('uses the v4 program id', () => {
    expect(SQUADS_PROGRAM_ID).toBe('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
  });

  it('derives the multisig from its create key', async () => {
    expect(await multisigPda(address('3TPczDPBfQpA6KiHSwYC51Qwzn1DJApVwqCK88zB69Au'))).toBe('ApWUnzn3vomRRt2aVhoxSXkd7JrPNf7hcFyehz9ivJD7');
  });

  it('derives vaults by index', async () => {
    expect(await vaultPda(MULTISIG, 0)).toBe('H92mY1R6CYDPpHjisrE3C7xqfgp7751f2R13aRoT4SbB');
    expect(await vaultPda(MULTISIG, 3)).toBe('D3fxyAUGACaifNjHMYiBZRv3PBzwCVKpLAnLkBxBKw1q');
    await expect(vaultPda(MULTISIG, 256)).rejects.toThrow();
  });

  it.each([
    [1n, 'DvEPCTJkLayTDA262J5Qfntd962BjwFCPwXAhvwgAG8s', '2kFj8ETqsGnCSuS9TVdrKtdXTtE4zMYwYaUBguSXxicR'],
    [7n, '5PfFHbdBYgtrGbphqVrXBD5wSeZkmgE2XsjadnEgQo5T', 'E3yYFAGoXyx3vpsUoJnK4wmSxXPoNtwVMt5rMMrra4iW'],
    [300n, '2rTiMGohWbDpT95EeCzQrU7dACkutT8qYSFN4s6CDQpa', '4quDbpP1NHtjf6sLaPwdofdFTq2Ls8pcrRyhTdsDmYvH'],
  ])('derives transaction and proposal %s', async (index, tx, proposal) => {
    expect(await transactionPda(MULTISIG, index)).toBe(tx);
    expect(await proposalPda(MULTISIG, index)).toBe(proposal);
  });
});
