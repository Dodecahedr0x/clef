import {
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  getTransactionDecoder,
  getTransactionEncoder,
  signBytes,
  type Address,
  type SignatureBytes,
} from '@solana/kit';

export class NotASignerError extends Error {
  constructor(account: string) {
    super(`${account} is not a required signer of this transaction`);
    this.name = 'NotASignerError';
  }
}

/** Imports the key non-extractable and checks it belongs to `account`. The caller zeroes its byte copy. */
async function keyFor(account: Address, privateKey: Uint8Array): Promise<CryptoKey> {
  const pair = await createKeyPairFromPrivateKeyBytes(privateKey);
  if ((await getAddressFromPublicKey(pair.publicKey)) !== account) throw new Error('Private key does not match the account');
  return pair.privateKey;
}

/** Adds `account`'s signature to a wire transaction (legacy, v0 or v1). Other signatures are left untouched. */
export async function signTransactionWire(wire: Uint8Array, account: Address, privateKey: Uint8Array): Promise<Uint8Array> {
  const tx = getTransactionDecoder().decode(wire);
  if (!Object.hasOwn(tx.signatures, account)) throw new NotASignerError(account);
  const key = await keyFor(account, privateKey);
  const signature = await signBytes(key, tx.messageBytes);
  return new Uint8Array(getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, [account]: signature } }));
}

export async function signMessageBytes(message: Uint8Array, account: Address, privateKey: Uint8Array): Promise<SignatureBytes> {
  return signBytes(await keyFor(account, privateKey), message);
}
