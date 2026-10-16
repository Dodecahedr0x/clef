import { KitChainReader } from '@clef/rpc';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  getU64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Address,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { describe, expect, inject, it } from 'vitest';
import { fund, rpcCall } from '../../../test/surfpool/cheats';
import {
  buildExecuteTransaction,
  buildProposeTransaction,
  buildVoteTransaction,
  decodeProgramConfig,
  fetchMultisig,
  listProposals,
  multisigPda,
  programConfigPda,
  SQUADS_PROGRAM_ID,
  vaultPda,
} from '../src';

const url = inject('surfpoolRpcUrl');
const SOL = 1_000_000_000n;

async function blockhash(): Promise<string> {
  const { value } = await rpcCall<{ value: { blockhash: string } }>(url, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return value.blockhash;
}

async function balance(address: Address): Promise<bigint> {
  const { value } = await rpcCall<{ value: number }>(url, 'getBalance', [address, { commitment: 'confirmed' }]);
  return BigInt(value);
}

async function send(wire: Uint8Array, signers: KeyPairSigner[]): Promise<void> {
  const signed = await signTransaction(
    signers.map((s) => s.keyPair),
    getTransactionDecoder().decode(wire),
  );
  const sig = await rpcCall<string>(url, 'sendTransaction', [getBase64EncodedWireTransaction(signed), { encoding: 'base64' }]);
  for (let i = 0; i < 100; i++) {
    const { value } = await rpcCall<{ value: ({ confirmationStatus: string; err: unknown } | null)[] }>(url, 'getSignatureStatuses', [[sig]]);
    const status = value[0];
    if (status?.err) throw new Error(`${sig} failed: ${JSON.stringify(status.err)}`);
    if (status && status.confirmationStatus !== 'processed') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${sig} not confirmed`);
}

function unsignedWire(feePayer: Address, hash: string, instructions: Instruction[]): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: hash as Blockhash, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

/** multisig_create_v2: autonomous multisig, all members with every permission, no time lock. */
async function createMultisig(creator: KeyPairSigner, createKey: KeyPairSigner, members: Address[], threshold: number): Promise<Address> {
  const programConfig = await programConfigPda();
  const [config] = await new KitChainReader(url).getAccounts([programConfig]);
  if (!config) throw new Error('Squads program config missing from the surfpool snapshot');
  const { treasury } = decodeProgramConfig(config.data);
  await fund(url, treasury, SOL);
  const multisig = await multisigPda(createKey.address);
  const data = [
    0x32, 0xdd, 0xc7, 0x5d, 0x28, 0xf5, 0x8b, 0xe9, // discriminator
    0, // config_authority: None
    threshold & 0xff, threshold >> 8,
    members.length, 0, 0, 0,
    ...members.flatMap((m) => [...getAddressEncoder().encode(m), 0b111]),
    0, 0, 0, 0, // time_lock
    0, // rent_collector: None
    0, // memo: None
  ];
  const ix: Instruction = {
    programAddress: SQUADS_PROGRAM_ID,
    accounts: [
      { address: programConfig, role: AccountRole.READONLY },
      { address: treasury, role: AccountRole.WRITABLE },
      { address: multisig, role: AccountRole.WRITABLE },
      { address: createKey.address, role: AccountRole.READONLY_SIGNER },
      { address: creator.address, role: AccountRole.WRITABLE_SIGNER },
      { address: '11111111111111111111111111111111' as Address, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(data),
  };
  await send(unsignedWire(creator.address, await blockhash(), [ix]), [creator, createKey]);
  return multisig;
}

describe('Squads v4 against surfpool', () => {
  it('creates a 2-of-3, proposes a SOL transfer from vault 0, approves twice and executes', async () => {
    const chain = new KitChainReader(url);
    const [m1, m2, m3, createKey, recipient] = await Promise.all(Array.from({ length: 5 }, () => generateKeyPairSigner()));
    for (const m of [m1!, m2!, m3!]) await fund(url, m.address, 10n * SOL);

    const multisig = await createMultisig(m1!, createKey!, [m1!.address, m2!.address, m3!.address], 2);
    const info = await fetchMultisig(chain, multisig);
    expect(info).toMatchObject({ threshold: 2, transactionIndex: 0n, timeLock: 0 });
    expect(info!.members.map((m) => m.key).sort()).toEqual([m1!.address, m2!.address, m3!.address].sort());

    const vault = await vaultPda(multisig, 0);
    await fund(url, vault, 2n * SOL);
    const transfer: Instruction = {
      programAddress: '11111111111111111111111111111111' as Address,
      accounts: [
        { address: vault, role: AccountRole.WRITABLE_SIGNER },
        { address: recipient!.address, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array([2, 0, 0, 0, ...getU64Encoder().encode(SOL / 2n)]),
    };
    const inner = unsignedWire(vault, await blockhash(), [transfer]);

    const index = info!.transactionIndex + 1n;
    await send(await buildProposeTransaction({ multisig, vaultIndex: 0, member: m1!.address, innerWire: inner, transactionIndex: index, blockhash: await blockhash() }), [m1!]);
    let [proposal] = await listProposals(chain, multisig, { limit: 5 });
    expect(proposal).toMatchObject({ index, status: 'active', approved: [m1!.address] });
    expect(proposal!.innerMessage).not.toBeNull();

    await send(await buildVoteTransaction({ multisig, member: m2!.address, transactionIndex: index, vote: 'approve', blockhash: await blockhash() }), [m2!]);
    [proposal] = await listProposals(chain, multisig, { limit: 5 });
    expect(proposal!.status).toBe('approved');
    expect([...proposal!.approved].sort()).toEqual([m1!.address, m2!.address].sort());

    const before = await balance(vault);
    await send(await buildExecuteTransaction(chain, { multisig, member: m3!.address, transactionIndex: index, blockhash: await blockhash() }), [m3!]);
    expect(await balance(vault)).toBe(before - SOL / 2n);
    expect(await balance(recipient!.address)).toBe(SOL / 2n);
    [proposal] = await listProposals(chain, multisig, { limit: 5 });
    expect(proposal!.status).toBe('executed');
  });
});
