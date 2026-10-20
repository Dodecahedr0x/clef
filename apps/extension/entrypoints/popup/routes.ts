export type Route =
  | { name: 'home' }
  | { name: 'token'; mint: string }
  | { name: 'send'; mint?: string; to?: string }
  | { name: 'receive' }
  | { name: 'swap'; inputMint?: string; outputMint?: string }
  | { name: 'history' }
  | { name: 'history/tx'; signature: string; origin?: string }
  /** `section`: open scrolled to it, its first field focused (a rate-limited swap points at the Jupiter key). */
  | { name: 'settings'; section?: 'swaps' }
  | { name: 'settings/sites' }
  | { name: 'settings/idls'; addFor?: string }
  | { name: 'settings/idls/view'; programId: string; network: string; tier: 'yours' | 'curated' | 'published' | 'chain' }
  | { name: 'settings/contacts' }
  | { name: 'settings/network' }
  | { name: 'settings/security' }
  | { name: 'accounts' }
  | { name: 'accounts/add' }
  | { name: 'accounts/squads' }
  /** A first recovery phrase for a wallet started from a private key or watch-only: shown, then checked. */
  | { name: 'accounts/new-phrase' }
  | { name: 'accounts/confirm-phrase' }
  | { name: 'proposals'; multisig: string }
  | { name: 'welcome' }
  | { name: 'create-password'; next: 'create' | 'import'; tab?: ImportTab }
  | { name: 'recovery-phrase' }
  | { name: 'confirm-phrase' }
  | { name: 'import'; tab?: ImportTab }
  | { name: 'unlock' };

export type RouteName = Route['name'];
export type ImportTab = 'phrase' | 'key' | 'watch';
