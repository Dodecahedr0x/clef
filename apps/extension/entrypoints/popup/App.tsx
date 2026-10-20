import { useEffect, type JSX } from 'react';
import { Alert, NetworkEdge, Spinner } from '../../components';
import type { FullState } from '../../lib/api';
import { useWallet } from '../../lib/hooks';
import { NavProvider, useNav } from '../../lib/nav';
import { clusterOf } from '../../lib/network';
import { StaleBackgroundBanner } from '../../lib/stale-banner';
import type { Route, RouteName } from './routes';
import { AccountsScreen } from './screens/Accounts';
import { AddAccountScreen } from './screens/AddAccount';
import { AddressBookScreen } from './screens/AddressBook';
import { ConfirmPhraseScreen } from './screens/ConfirmPhrase';
import { ConnectedSitesScreen } from './screens/ConnectedSites';
import { CreatePasswordScreen } from './screens/CreatePassword';
import { HistoryScreen } from './screens/History';
import { IdlManagerScreen } from './screens/IdlManager';
import { IdlViewScreen } from './screens/IdlView';
import { ImportScreen } from './screens/Import';
import { NetworkRpcScreen } from './screens/NetworkRpc';
import { PortfolioScreen } from './screens/Portfolio';
import { ProposalsScreen } from './screens/Proposals';
import { ReceiveScreen } from './screens/Receive';
import { RecoveryPhraseScreen } from './screens/RecoveryPhrase';
import { SecurityScreen } from './screens/Security';
import { SendScreen } from './screens/Send';
import { SettingsScreen } from './screens/Settings';
import { SquadsAddScreen } from './screens/SquadsAdd';
import { SwapScreen } from './screens/Swap';
import { TokenDetailScreen } from './screens/TokenDetail';
import { TxDetailScreen } from './screens/TxDetail';
import { UnlockScreen } from './screens/Unlock';
import { WelcomeScreen } from './screens/Welcome';

const SCREENS: Record<RouteName, () => JSX.Element> = {
  home: PortfolioScreen,
  token: TokenDetailScreen,
  send: SendScreen,
  receive: ReceiveScreen,
  swap: SwapScreen,
  history: HistoryScreen,
  'history/tx': TxDetailScreen,
  settings: SettingsScreen,
  'settings/sites': ConnectedSitesScreen,
  'settings/idls': IdlManagerScreen,
  'settings/idls/view': IdlViewScreen,
  'settings/contacts': AddressBookScreen,
  'settings/network': NetworkRpcScreen,
  'settings/security': SecurityScreen,
  accounts: AccountsScreen,
  'accounts/add': AddAccountScreen,
  'accounts/squads': SquadsAddScreen,
  proposals: ProposalsScreen,
  welcome: WelcomeScreen,
  'create-password': CreatePasswordScreen,
  'recovery-phrase': RecoveryPhraseScreen,
  'confirm-phrase': ConfirmPhraseScreen,
  'accounts/new-phrase': RecoveryPhraseScreen,
  'accounts/confirm-phrase': ConfirmPhraseScreen,
  import: ImportScreen,
  unlock: UnlockScreen,
};

const ONBOARDING = new Set<RouteName>(['welcome', 'create-password', 'recovery-phrase', 'confirm-phrase', 'import']);
/** Screens that only make sense before a wallet exists ('import' also adds accounts to an existing wallet). */
const CREATE_ONLY = new Set<RouteName>(['welcome', 'create-password', 'recovery-phrase', 'confirm-phrase']);

function entryRoute(state: FullState): Route {
  if (!state.hasVault) return { name: 'welcome' };
  if (!state.unlocked) return { name: 'unlock' };
  if (location.hash === '#import-key') return { name: 'import' };
  if (location.hash === '#network') return { name: 'settings/network' };
  return { name: 'home' };
}

/** Keeps the route consistent with the wallet: no vault -> onboarding, locked (e.g. auto-lock) -> unlock, unlocked -> never back on create-only screens. */
function Guard({ state }: { state: FullState }) {
  const nav = useNav();
  const name = nav.route.name;
  useEffect(() => {
    if (!state.hasVault && !ONBOARDING.has(name)) nav.reset({ name: 'welcome' });
    // Locked while in use (auto-lock): unlocking comes back here, with what was typed.
    else if (state.hasVault && !state.unlocked && name !== 'unlock') nav.suspend({ name: 'unlock' });
    else if (state.hasVault && state.unlocked && name === 'unlock') nav.resume({ name: 'home' });
    else if (state.hasVault && state.unlocked && CREATE_ONLY.has(name)) nav.reset({ name: 'home' });
  }, [state.hasVault, state.unlocked, name, nav]);
  return null;
}

function Router() {
  const { route } = useNav();
  const Screen = SCREENS[route.name];
  return <Screen key={JSON.stringify(route)} />;
}

export function App() {
  const { state, error } = useWallet();
  if (error) {
    return (
      <div className="flex h-full items-center p-4">
        <Alert severity="danger" title="Clef did not respond">
          {error}
        </Alert>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <Spinner />
      </div>
    );
  }
  return (
    <NavProvider initial={entryRoute(state)}>
      <Guard state={state} />
      <div className="flex h-full flex-col">
        <NetworkEdge cluster={clusterOf(state.settings)} tint={state.settings.devnetTint} />
        <StaleBackgroundBanner />
        <div className="min-h-0 flex-1">
          <Router />
        </div>
      </div>
    </NavProvider>
  );
}
