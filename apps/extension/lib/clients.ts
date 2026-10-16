import { createContext } from 'react';
import type { ExplainContext } from '@clef/explain';
import { createDefaultResolver, UserIdlSource } from '@clef/idl';
import { JupiterClient } from '@clef/market';
import { KitChainReader, KitPortfolioReader, type ChainReader } from '@clef/rpc';
import type { Contact, Settings, UserIdl } from '@clef/wallet-core';
import type { Address } from '@solana/kit';
import type { FullState } from './api';

export type Clients = { chain: KitChainReader; portfolio: KitPortfolioReader; jupiter: JupiterClient };

export function createClients(s: Settings): Clients {
  return {
    chain: new KitChainReader(s.rpcUrl),
    portfolio: new KitPortfolioReader(s.rpcUrl),
    jupiter: new JupiterClient({ apiKey: s.jupiterApiKey }),
  };
}

export type ExplainExtras = { contacts: Contact[]; userIdls: UserIdl[]; prices?: Record<string, number> };

/** Labels come from the user's accounts (winning over contacts); user IDLs for the current network are the 'user' source. */
export function createExplainContext(state: FullState, extras: ExplainExtras, chain: ChainReader): ExplainContext {
  const user = new UserIdlSource();
  for (const idl of extras.userIdls) if (idl.network === state.settings.network) user.set(idl.programId, idl.json);
  const addressBook: Record<string, string> = {};
  for (const c of extras.contacts) addressBook[c.address] = c.name;
  for (const a of state.accounts) addressBook[a.address] = a.label;
  return {
    reader: chain,
    idls: createDefaultResolver(chain, user),
    me: state.accounts.map((a) => a.address as Address),
    addressBook,
    ...(extras.prices ? { prices: extras.prices } : {}),
  };
}

export type ClientsFactory = (s: Settings) => Clients;
/** Tests provide fake clients here; the popup uses the default. */
export const ClientsContext = createContext<ClientsFactory>(createClients);
