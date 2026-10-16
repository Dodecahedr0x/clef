import { createContext, useContext } from 'react';

/** Where an approval is shown: its own popup window (sized per level) or the side panel (fills it, never resizes). */
export const ApprovalHost = createContext<'window' | 'panel'>('window');
export const useApprovalHost = () => useContext(ApprovalHost);
