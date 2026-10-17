import { createDefaultResolver, UserIdlSource } from '@clef/idl';
import { KitChainReader } from '@clef/rpc';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { address, generateKeyPairSigner } from '@solana/kit';
import { describe, expect, inject, it } from 'vitest';
import { fund } from '../../../test/surfpool/cheats';
import { explain } from '../src';
import { buildWire } from './helpers';

const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const url = inject('surfpoolRpcUrl');

describe('transfers from a real simulation (surfpool)', () => {
  it('lists the account funding the ATA program makes through System (a CPI), and marks the ATA created', async () => {
    const payer = await generateKeyPairSigner();
    await fund(url, payer.address, 1_000_000_000n);
    const [ata] = await findAssociatedTokenPda({ owner: payer.address, mint: USDC, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const ix = getCreateAssociatedTokenIdempotentInstruction({ payer, ata, owner: payer.address, mint: USDC });
    const reader = new KitChainReader(url);
    const ex = await explain({ wire: buildWire([ix], { feePayer: payer.address }) }, { reader, idls: createDefaultResolver(reader, new UserIdlSource()), me: [payer.address] });

    expect(ex.transfersPartial).toBeUndefined();
    const funding = ex.transfers?.find((t) => t.to === ata && t.inner);
    expect(funding?.from).toBe(payer.address);
    expect(funding?.amount).toBeGreaterThan(0n);
    const fact = ex.accountFacts.find((f) => f.address === ata)!;
    expect(fact.lifecycle).toBe('created');
    expect(fact.owner).toBe(TOKEN_PROGRAM_ADDRESS);
    expect(fact.token).toMatchObject({ mint: USDC, holder: payer.address, before: 0n, after: 0n });
  });
});
