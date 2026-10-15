import {
  SolanaSignAndSendTransaction,
  SolanaSignIn,
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignAndSendTransactionInput,
  type SolanaSignAndSendTransactionOutput,
  type SolanaSignInFeature,
  type SolanaSignInInput,
  type SolanaSignInOutput,
  type SolanaSignMessageFeature,
  type SolanaSignMessageInput,
  type SolanaSignMessageOutput,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionInput,
  type SolanaSignTransactionOutput,
} from '@solana/wallet-standard-features';
import { getBase58Encoder } from '@solana/kit';
import type { IdentifierString, Wallet, WalletAccount } from '@wallet-standard/base';
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardConnectInput,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
  type StandardEventsListeners,
  type StandardEventsNames,
} from '@wallet-standard/features';
import { ReadonlyWalletAccount } from '@wallet-standard/wallet';
import { ICON } from './icon';

/** Transport to the extension (implemented over window.postMessage + the relay content script). */
export interface Bridge {
  request(method: string, params: unknown): Promise<unknown>;
  onEvent(cb: (accounts: string[]) => void): void;
}

const CHAINS = ['solana:mainnet', 'solana:devnet'] as const;
const DEFAULT_CHAIN: IdentifierString = 'solana:mainnet';
const ACCOUNT_FEATURES = [SolanaSignTransaction, SolanaSignAndSendTransaction, SolanaSignMessage, SolanaSignIn] as const;

const toB64 = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

type Features = StandardConnectFeature &
  StandardDisconnectFeature &
  StandardEventsFeature &
  SolanaSignTransactionFeature &
  SolanaSignAndSendTransactionFeature &
  SolanaSignMessageFeature &
  SolanaSignInFeature;

/** The "Clef" wallet as dApps see it. Holds no secrets: every operation is a request to the extension. */
export class ClefWallet implements Wallet {
  readonly version = '1.0.0' as const;
  readonly name = 'Clef';
  readonly icon = ICON;
  readonly chains = CHAINS;
  readonly features: Features;
  #accounts: WalletAccount[] = [];
  #listeners: { [E in StandardEventsNames]?: StandardEventsListeners[E][] } = {};

  constructor(private readonly bridge: Bridge) {
    bridge.onEvent((addresses) => this.#setAccounts(addresses));
    this.features = {
      [StandardConnect]: { version: '1.0.0', connect: this.#connect },
      [StandardDisconnect]: { version: '1.0.0', disconnect: this.#disconnect },
      [StandardEvents]: { version: '1.0.0', on: this.#on },
      [SolanaSignTransaction]: { version: '1.0.0', supportedTransactionVersions: ['legacy', 0, 1], signTransaction: this.#signTransaction },
      [SolanaSignAndSendTransaction]: { version: '1.0.0', supportedTransactionVersions: ['legacy', 0, 1], signAndSendTransaction: this.#signAndSend },
      [SolanaSignMessage]: { version: '1.1.0', signMessage: this.#signMessage },
      [SolanaSignIn]: { version: '1.0.0', signIn: this.#signIn },
    };
  }

  get accounts(): readonly WalletAccount[] {
    return this.#accounts.slice();
  }

  #account(address: string): WalletAccount {
    return new ReadonlyWalletAccount({
      address,
      publicKey: new Uint8Array(getBase58Encoder().encode(address)),
      chains: CHAINS,
      features: ACCOUNT_FEATURES,
    });
  }

  #setAccounts(addresses: string[]): void {
    const same = addresses.length === this.#accounts.length && addresses.every((a, i) => a === this.#accounts[i]!.address);
    if (same) return;
    this.#accounts = addresses.map((a) => this.#account(a));
    for (const listener of this.#listeners.change ?? []) listener({ accounts: this.accounts });
  }

  #requireAccount(account: WalletAccount): string {
    if (!this.#accounts.some((a) => a.address === account.address)) throw new Error('Account not connected');
    return account.address;
  }

  #connect = async (input?: StandardConnectInput) => {
    const { accounts } = (await this.bridge.request('connect', { silent: !!input?.silent })) as { accounts: string[] };
    this.#setAccounts(accounts);
    return { accounts: this.accounts };
  };

  #disconnect = async () => {
    await this.bridge.request('disconnect', {});
    this.#setAccounts([]);
  };

  #on = <E extends StandardEventsNames>(event: E, listener: StandardEventsListeners[E]): (() => void) => {
    const list = (this.#listeners[event] ??= []) as StandardEventsListeners[E][];
    list.push(listener);
    return () => {
      this.#listeners[event] = list.filter((l) => l !== listener) as never;
    };
  };

  /** Consecutive inputs for the same account and chain go in one request (one approval); output order matches input order. */
  #signTransaction = async (...inputs: readonly SolanaSignTransactionInput[]): Promise<readonly SolanaSignTransactionOutput[]> => {
    const outputs: SolanaSignTransactionOutput[] = [];
    let i = 0;
    while (i < inputs.length) {
      const first = inputs[i]!;
      const account = this.#requireAccount(first.account);
      const chain = first.chain ?? DEFAULT_CHAIN;
      const group: SolanaSignTransactionInput[] = [];
      while (i < inputs.length && inputs[i]!.account.address === account && (inputs[i]!.chain ?? DEFAULT_CHAIN) === chain) group.push(inputs[i++]!);
      const { signedTransactions } = (await this.bridge.request('signTransaction', {
        account,
        chain,
        transactions: group.map((g) => toB64(g.transaction)),
      })) as { signedTransactions: string[] };
      outputs.push(...signedTransactions.map((t) => ({ signedTransaction: fromB64(t) })));
    }
    return outputs;
  };

  #signAndSend = async (...inputs: readonly SolanaSignAndSendTransactionInput[]): Promise<readonly SolanaSignAndSendTransactionOutput[]> => {
    const outputs: SolanaSignAndSendTransactionOutput[] = [];
    for (const input of inputs) {
      const { signature } = (await this.bridge.request('signAndSendTransaction', {
        account: this.#requireAccount(input.account),
        chain: input.chain,
        transaction: toB64(input.transaction),
        skipPreflight: input.options?.skipPreflight === true,
      })) as { signature: string };
      outputs.push({ signature: fromB64(signature) });
    }
    return outputs;
  };

  #signMessage = async (...inputs: readonly SolanaSignMessageInput[]): Promise<readonly SolanaSignMessageOutput[]> => {
    const outputs: SolanaSignMessageOutput[] = [];
    for (const input of inputs) {
      const { signedMessage, signature } = (await this.bridge.request('signMessage', {
        account: this.#requireAccount(input.account),
        message: toB64(input.message),
      })) as { signedMessage: string; signature: string };
      outputs.push({ signedMessage: fromB64(signedMessage), signature: fromB64(signature), signatureType: 'ed25519' });
    }
    return outputs;
  };

  #signIn = async (...inputs: readonly SolanaSignInInput[]): Promise<readonly SolanaSignInOutput[]> => {
    const outputs: SolanaSignInOutput[] = [];
    for (const input of inputs) {
      const { account, signedMessage, signature } = (await this.bridge.request('signIn', { input: { ...input } })) as {
        account: string;
        signedMessage: string;
        signature: string;
      };
      if (!this.#accounts.some((a) => a.address === account)) this.#setAccounts([...this.#accounts.map((a) => a.address), account]);
      outputs.push({ account: this.#account(account), signedMessage: fromB64(signedMessage), signature: fromB64(signature), signatureType: 'ed25519' });
    }
    return outputs;
  };
}
