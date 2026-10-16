import { createContext, useContext } from 'react';

/** Whether the bodies explain a request about to be signed (simulated) or a transaction already on chain (its meta). */
export const ExplainSource = createContext<'simulation' | 'chain'>('simulation');
export const useOnChain = (): boolean => useContext(ExplainSource) === 'chain';
