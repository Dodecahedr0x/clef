import {
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from '@solana/kit';
import type { ChainReader } from '@clef/rpc';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '@clef/explain';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
} from '@solana-program/token';
import type { PortfolioReader } from './deps';

const MINT_DECIMALS_OFFSET = 44;

export async function buildSendTransaction(
  deps: { chain: ChainReader; reader: PortfolioReader },
  p: { from: Address; to: Address; mint: 'SOL' | Address; amount: bigint },
): Promise<{ wire: Uint8Array; createsAta: boolean; lastValidBlockHeight: bigint }> {
  const signer = createNoopSigner(p.from);
  const instructions: Instruction[] = [];
  let createsAta = false;

  if (p.mint === 'SOL') {
    instructions.push(getTransferSolInstruction({ source: signer, destination: p.to, amount: p.amount }));
  } else {
    const mint = p.mint;
    const [mintAccount] = await deps.chain.getAccounts([mint]);
    const decimals = mintAccount?.data[MINT_DECIMALS_OFFSET];
    if (!mintAccount || (mintAccount.owner !== TOKEN_PROGRAM && mintAccount.owner !== TOKEN_2022_PROGRAM) || decimals === undefined)
      throw new Error('Unknown token mint');
    const tokenProgram = mintAccount.owner;
    const [source] = await findAssociatedTokenPda({ owner: p.from, mint, tokenProgram });
    const [destination] = await findAssociatedTokenPda({ owner: p.to, mint, tokenProgram });
    const [destAccount] = await deps.chain.getAccounts([destination]);
    if (!destAccount) {
      createsAta = true;
      instructions.push(getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: destination, owner: p.to, mint, tokenProgram }));
    }
    instructions.push(
      getTransferCheckedInstruction({ source, mint, destination, authority: signer, amount: p.amount, decimals }, { programAddress: tokenProgram }),
    );
  }

  const latest = await deps.reader.getLatestBlockhash();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(p.from, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(latest.blockhash), lastValidBlockHeight: latest.lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  return { wire, createsAta, lastValidBlockHeight: latest.lastValidBlockHeight };
}
