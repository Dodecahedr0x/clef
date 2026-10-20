import { createContext, useContext } from 'react';
import type { KnownAddress } from '../../../lib/hooks';

/** Whether the bodies explain a request about to be signed (simulated) or a transaction already on chain (its meta). */
export const ExplainSource = createContext<'simulation' | 'chain'>('simulation');
export const useOnChain = (): boolean => useContext(ExplainSource) === 'chain';

/** Opens the way to add an IDL for a program whose instructions Clef could not decode (absent: no link shown). */
export const IdlAdder = createContext<((programId: string) => void) | null>(null);
export const useIdlAdder = () => useContext(IdlAdder);

export const AddressBook = createContext<(address: string) => KnownAddress | null>(() => null);
export const useAddressBook = () => useContext(AddressBook);
