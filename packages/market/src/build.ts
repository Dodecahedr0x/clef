import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Encoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type AddressesByLookupTableAddress,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import { JupiterError } from './types';

export type ApiInstruction = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};

export type BuildResponse = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string | number;
  routePlan?: { percent: number; swapInfo?: { label?: string } }[];
  computeBudgetInstructions?: ApiInstruction[] | null;
  setupInstructions?: ApiInstruction[] | null;
  swapInstruction?: ApiInstruction | null;
  cleanupInstruction?: ApiInstruction | null;
  otherInstructions?: ApiInstruction[] | null;
  tipInstruction?: ApiInstruction | null;
  addressesByLookupTableAddress?: Record<string, string[]> | null;
  blockhashWithMetadata?: { blockhash: number[] | string; lastValidBlockHeight: number | string };
};

const malformed = (what: string) => new JupiterError('unavailable', `Jupiter returned an unusable swap (${what})`);

function role(a: ApiInstruction['accounts'][number]): AccountRole {
  if (a.isSigner) return a.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  return a.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

function toInstruction(ix: ApiInstruction): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((a) => ({ address: address(a.pubkey), role: role(a) })),
    data: new Uint8Array(getBase64Encoder().encode(ix.data)),
  };
}

// Order from developers.jup.ag/docs/swap/migration/metis-to-build.
export function assembleSwap(res: BuildResponse, taker: string): { wire: Uint8Array; lastValidBlockHeight: bigint } {
  if (!res.swapInstruction) throw malformed('no swap instruction');
  const meta = res.blockhashWithMetadata;
  if (!meta) throw malformed('no blockhash');
  const blockhash = (typeof meta.blockhash === 'string'
    ? meta.blockhash
    : getBase58Decoder().decode(Uint8Array.from(meta.blockhash))) as Blockhash;
  const lastValidBlockHeight = BigInt(meta.lastValidBlockHeight);

  const raw: (ApiInstruction | null | undefined)[] = [
    ...(res.computeBudgetInstructions ?? []),
    ...(res.setupInstructions ?? []),
    res.swapInstruction,
    res.cleanupInstruction,
    ...(res.otherInstructions ?? []),
    res.tipInstruction,
  ];
  let instructions: Instruction[];
  let tables: AddressesByLookupTableAddress;
  try {
    instructions = raw.filter((ix): ix is ApiInstruction => !!ix).map(toInstruction);
    tables = Object.fromEntries(
      Object.entries(res.addressesByLookupTableAddress ?? {}).map(([k, v]) => [address(k), v.map((a) => address(a))]),
    ) as Record<Address, Address[]>;
  } catch {
    throw malformed('invalid instruction');
  }

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(taker), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => compressTransactionMessageUsingAddressLookupTables(m, tables),
  );
  const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  return { wire, lastValidBlockHeight };
}
