import '@testing-library/jest-dom/vitest';
import { DEFAULT_RPC } from '@clef/wallet-core';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({
  browser: {
    storage: { onChanged: { addListener: () => {}, removeListener: () => {} } },
    runtime: { sendMessage: () => Promise.resolve(undefined) },
  },
}));

type Call = { type: string } & Record<string, unknown>;
const api = vi.hoisted(() => ({
  state: null as any,
  calls: [] as Call[],
  handlers: {} as Record<string, (c: Call) => unknown>,
}));

vi.mock('../lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../lib/api')>();
  const call = async (c: Call) => {
    api.calls.push(c);
    if (c.type === 'state') return structuredClone(api.state);
    const h = api.handlers[c.type];
    if (!h) throw new Error(`unexpected call ${c.type}`);
    return h(c);
  };
  return { ...orig, call, getState: () => call({ type: 'state' }) };
});

import { ClientsContext } from '../lib/clients';
import { NavContext, type Nav } from '../lib/nav';
import { AddressBookScreen } from '../entrypoints/popup/screens/AddressBook';
import { ConnectedSitesScreen } from '../entrypoints/popup/screens/ConnectedSites';
import { IdlManagerScreen } from '../entrypoints/popup/screens/IdlManager';
import { IdlViewScreen } from '../entrypoints/popup/screens/IdlView';
import { NetworkRpcScreen } from '../entrypoints/popup/screens/NetworkRpc';
import { SecurityScreen } from '../entrypoints/popup/screens/Security';
import { SettingsScreen } from '../entrypoints/popup/screens/Settings';

const MAIN = '3VzwJ9ENt2zPAMFn944zmPZE2snSvMQLg6fHA4fAeKwA';
const ALICE = '5zzsbHTkm4ymKhWZH78zXn7T4kZtqhogMCKZK8KLHesK';
const BOB = '8VzotRh8e6y9V3mLRACzJAfg6dMLm4D22HyqUByVvyoU';
const PROG = 'AzzkBZvWX8xXeQ27ZDGz4ZDu8W8ngQcMhPe7dFdfaJjd';

let nav: Nav & { go: ReturnType<typeof vi.fn>; back: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> };
let hasDas: () => Promise<boolean>;
let getHealth: ReturnType<typeof vi.fn<() => Promise<{ slot: bigint; latencyMs: number }>>>;
let contacts: { address: string; name: string; kind: 'contact' | 'label'; note?: string; createdAt: number }[];
let idls: { programId: string; network: string; name: string; json: string; hash: string; addedAt: number }[];

function baseState() {
  return {
    hasVault: true,
    unlocked: true,
    activeAccount: MAIN,
    errorReportsAvailable: false,
    accounts: [{ kind: 'hd', address: MAIN, label: 'Main', index: 0 }],
    permissions: [
      { origin: 'https://jup.ag', accounts: [MAIN], connectedAt: Date.now() - 60_000 },
      { origin: 'https://lend.example', accounts: [MAIN], connectedAt: Date.now() - 86_400_000 },
    ],
    settings: {
      network: 'mainnet',
      rpcUrl: 'https://rpc.example.com/key',
      customCluster: 'mainnet',
      autoLockMinutes: 15,
      detailLevel: 'intermediate',
      hideSpam: true,
      networkSwitchInHeader: true,
      devnetTint: true,
      jupiterApiKey: null,
      errorReports: false,
    },
  };
}

beforeEach(() => {
  api.calls = [];
  api.state = baseState();
  hasDas = async () => true;
  getHealth = vi.fn(async () => ({ slot: 1n, latencyMs: 84 }));
  contacts = [
    { address: ALICE, name: 'Alice', kind: 'contact', note: 'sent 3x', createdAt: 1 },
    { address: BOB, name: 'Bob', kind: 'contact', createdAt: 2 },
    { address: PROG, name: 'Escrow vault', kind: 'label', createdAt: 3 },
  ];
  idls = [{ programId: PROG, network: 'devnet', name: 'my_escrow', json: '{}', hash: 'h', addedAt: 1 }];
  api.handlers = {
    'settings:update': (c) => {
      api.state.settings = { ...api.state.settings, ...(c.patch as object) };
      return {};
    },
    'vault:lock': () => ({}),
    'permissions:revoke': (c) => {
      api.state.permissions = api.state.permissions.filter((p: { origin: string }) => p.origin !== c.origin);
      return {};
    },
    'contacts:list': () => structuredClone(contacts),
    'contacts:upsert': (c) => {
      const entry = { address: c.address as string, name: c.name as string, kind: c.kind as 'contact', note: c.note as string | undefined, createdAt: 9 };
      contacts = [...contacts.filter((x) => x.address !== entry.address), entry];
      return {};
    },
    'contacts:remove': (c) => {
      contacts = contacts.filter((x) => x.address !== c.address);
      return {};
    },
    'idls:list': () => structuredClone(idls),
    'idls:remove': (c) => {
      idls = idls.filter((x) => !(x.programId === c.programId && x.network === c.network));
      return {};
    },
  };
  nav = { route: { name: 'settings' }, go: vi.fn(), back: vi.fn(), replace: vi.fn(), reset: vi.fn(), suspend: vi.fn(), resume: vi.fn() } as typeof nav;
});

const factory = () =>
  ({
    portfolio: { hasDas: () => hasDas(), getHealth: () => getHealth() },
  }) as never;

function renderScreen(ui: ReactElement) {
  return render(
    <NavContext.Provider value={nav}>
      <ClientsContext.Provider value={factory}>{ui}</ClientsContext.Provider>
    </NavContext.Provider>,
  );
}

const patches = () => api.calls.filter((c) => c.type === 'settings:update').map((c) => c.patch);

describe('SettingsScreen', () => {
  it('opened at Swaps, focuses the Jupiter key field', async () => {
    nav = { ...nav, route: { name: 'settings', section: 'swaps' } } as typeof nav;
    renderScreen(<SettingsScreen />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Jupiter API key')));
  });

  it('shows every row with live counts, network, RPC host and DAS tag', async () => {
    renderScreen(<SettingsScreen />);
    expect(await screen.findByRole('radio', { name: 'Intermediate' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Instruction names, decoded values and verified accounts. Warnings show at every level.')).toBeInTheDocument();
    const sites = screen.getByRole('button', { name: /Connected sites/ });
    expect(within(sites).getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Password & recovery phrase/ })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^Network/ })).getByText('Mainnet')).toBeInTheDocument();
    const rpc = screen.getByRole('button', { name: /^RPC/ });
    expect(within(rpc).getByText('rpc.example.com')).toBeInTheDocument();
    expect(await within(rpc).findByText('DAS')).toBeInTheDocument();
    expect(await screen.findByText('1 added by you')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('button', { name: /Address book & labels/ })).getByText('3')).toBeInTheDocument());
    expect(screen.getByLabelText('Auto-lock')).toHaveValue('15');
  });

  it('hides the DAS tag when the RPC has no DAS', async () => {
    hasDas = async () => false;
    renderScreen(<SettingsScreen />);
    const rpc = await screen.findByRole('button', { name: /^RPC/ });
    await waitFor(() => expect(api.calls.some((c) => c.type === 'idls:list')).toBe(true));
    expect(within(rpc).queryByText('DAS')).toBeNull();
  });

  it('persists the detail level, auto-lock and hide-spam settings', async () => {
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />);
    await user.click(await screen.findByRole('radio', { name: 'Expert' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Expert' })).toHaveAttribute('aria-checked', 'true'));
    await user.selectOptions(screen.getByLabelText('Auto-lock'), '30');
    await user.click(screen.getByRole('switch', { name: /Hide spam tokens/ }));
    expect(patches()).toEqual([{ detailLevel: 'expert' }, { autoLockMinutes: 30 }, { hideSpam: false }]);
  });

  it('navigates to the sub-screens', async () => {
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />);
    await user.click(await screen.findByRole('button', { name: /Connected sites/ }));
    await user.click(screen.getByRole('button', { name: /Password & recovery phrase/ }));
    await user.click(screen.getByRole('button', { name: /^Network/ }));
    await user.click(screen.getByRole('button', { name: /Program IDLs/ }));
    await user.click(screen.getByRole('button', { name: /Address book & labels/ }));
    expect(nav.go.mock.calls.map((c) => c[0].name)).toEqual(['settings/sites', 'settings/security', 'settings/network', 'settings/idls', 'settings/contacts']);
  });

  it('stays put and shows the error when locking fails', async () => {
    api.handlers['vault:lock'] = () => {
      throw new Error('The wallet did not respond');
    };
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />);
    await user.click(await screen.findByRole('button', { name: /Lock now/ }));
    expect(await screen.findByText('The wallet did not respond')).toBeInTheDocument();
    expect(nav.reset).not.toHaveBeenCalled();
  });

  it('locks now and returns to the unlock screen', async () => {
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />);
    await user.click(await screen.findByRole('button', { name: /Lock now/ }));
    expect(api.calls.some((c) => c.type === 'vault:lock')).toBe(true);
    expect(nav.reset).toHaveBeenCalledWith({ name: 'unlock' });
  });

  it('shows the error reports toggle only when reporting is available', async () => {
    renderScreen(<SettingsScreen />);
    await screen.findByRole('radio', { name: 'Expert' });
    expect(screen.queryByRole('switch', { name: /error reports/i })).toBeNull();
  });

  it('toggles error reports when available', async () => {
    api.state.errorReportsAvailable = true;
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />);
    await user.click(await screen.findByRole('switch', { name: /Send error reports/ }));
    expect(patches()).toEqual([{ errorReports: true }]);
  });

  it('saves and clears the Jupiter API key', async () => {
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />);
    await user.type(await screen.findByLabelText('Jupiter API key'), ' k-123 ');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save key' })).toBeNull());
    expect(screen.getByLabelText('Jupiter API key')).toHaveValue('k-123');
    await user.clear(screen.getByLabelText('Jupiter API key'));
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(patches()).toEqual([{ jupiterApiKey: 'k-123' }, { jupiterApiKey: null }]);
  });

  it('shows the service error when a setting is rejected', async () => {
    api.handlers['settings:update'] = () => {
      throw new Error('Auto-lock must be between 1 minute and 24 hours');
    };
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />);
    await user.selectOptions(await screen.findByLabelText('Auto-lock'), '60');
    expect(await screen.findByText('Auto-lock must be between 1 minute and 24 hours')).toBeInTheDocument();
  });
});

describe('ConnectedSitesScreen', () => {
  it('lists sites with their account and disconnects one', async () => {
    const user = userEvent.setup();
    renderScreen(<ConnectedSitesScreen />);
    expect(await screen.findByText('jup.ag')).toBeInTheDocument();
    expect(screen.getByText('lend.example')).toBeInTheDocument();
    expect(screen.getAllByText(/^Main · connected/)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Disconnect jup.ag' }));
    await waitFor(() => expect(screen.queryByText('jup.ag')).toBeNull());
    expect(api.calls.filter((c) => c.type === 'permissions:revoke')).toEqual([{ type: 'permissions:revoke', origin: 'https://jup.ag' }]);
    expect(screen.getByText('lend.example')).toBeInTheDocument();
  });

  it('disconnects all sites', async () => {
    const user = userEvent.setup();
    renderScreen(<ConnectedSitesScreen />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect all' }));
    await screen.findByText('No connected sites');
    expect(api.calls.filter((c) => c.type === 'permissions:revoke').map((c) => c.origin)).toEqual(['https://jup.ag', 'https://lend.example']);
    expect(screen.queryByRole('button', { name: 'Disconnect all' })).toBeNull();
  });
});

describe('IdlManagerScreen', () => {
  const tierOf = (name: string) => within(screen.getByText(name).closest('li')!);

  it('lists your IDLs and the curated, published and on-chain programs', async () => {
    renderScreen(<IdlManagerScreen />);
    expect(await screen.findByText('my_escrow')).toBeInTheDocument();
    expect(tierOf('my_escrow').getByText('Yours')).toBeInTheDocument();
    expect(tierOf('my_escrow').getByText(/devnet/)).toBeInTheDocument();
    expect(tierOf('System Program').getByText('Curated')).toBeInTheDocument();
    expect(tierOf('pump.fun').getByText('Published')).toBeInTheDocument();
    expect(tierOf('Jupiter Aggregator v6').getByText('On-chain')).toBeInTheDocument();
  });

  it('searches by name or program ID and filters by tier', async () => {
    const user = userEvent.setup();
    renderScreen(<IdlManagerScreen />);
    await screen.findByText('my_escrow');
    const list = () => within(screen.getByRole('list', { name: 'Programs' }));
    await user.type(screen.getByLabelText('Search programs'), 'escr');
    expect(list().getAllByRole('listitem')).toHaveLength(1);
    await user.clear(screen.getByLabelText('Search programs'));
    await user.type(screen.getByLabelText('Search programs'), 'TokenkegQ');
    expect(list().getByText('Token Program')).toBeInTheDocument();
    expect(list().getAllByRole('listitem')).toHaveLength(1);
    await user.clear(screen.getByLabelText('Search programs'));
    await user.click(within(screen.getByRole('group', { name: 'IDL source' })).getByRole('button', { name: 'Curated' }));
    const items = list().getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(1);
    for (const li of items) expect(within(li).getByText('Curated')).toBeInTheDocument();
  });

  it('removes one of your IDLs', async () => {
    const user = userEvent.setup();
    renderScreen(<IdlManagerScreen />);
    await user.click(await screen.findByRole('button', { name: 'Remove my_escrow' }));
    await waitFor(() => expect(screen.queryByText('my_escrow')).toBeNull());
    expect(api.calls.find((c) => c.type === 'idls:remove')).toEqual({ type: 'idls:remove', programId: PROG, network: 'devnet' });
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('edits one of your IDLs: the form starts from it and saving replaces it', async () => {
    const user = userEvent.setup();
    api.handlers['idls:update'] = (c) => {
      idls = [{ programId: c.programId as string, network: c.network as string, name: c.name as string, json: c.json as string, hash: 'y', addedAt: 4 }];
      return idls[0];
    };
    renderScreen(<IdlManagerScreen />);
    await user.click(await screen.findByRole('button', { name: 'Edit my_escrow' }));
    const form = within(screen.getByRole('region', { name: 'Edit my_escrow' }));
    expect(form.getByLabelText('Program ID')).toHaveValue(PROG);
    expect(form.getByLabelText('IDL JSON')).toHaveValue(idls[0]!.json);
    const nameField = form.getByLabelText('Name (optional)');
    await user.clear(nameField);
    await user.type(nameField, 'escrow v2');
    await user.click(form.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Edit / })).toBeNull());
    expect(api.calls.filter((c) => c.type === 'idls:update').at(-1)).toMatchObject({ oldProgramId: PROG, oldNetwork: 'devnet', programId: PROG, network: 'devnet', name: 'escrow v2' });
    expect(await screen.findByText('escrow v2')).toBeInTheDocument();
  });

  it('opens any program to view what its IDL declares', async () => {
    const user = userEvent.setup();
    renderScreen(<IdlManagerScreen />);
    await user.click(await screen.findByRole('button', { name: 'View System Program' }));
    expect(nav.go).toHaveBeenCalledWith({ name: 'settings/idls/view', programId: '11111111111111111111111111111111', network: 'mainnet', tier: 'curated' });
  });

  it('opened from an undecodable instruction: the form is ready for that program and saving goes back', async () => {
    const user = userEvent.setup();
    api.handlers['idls:add'] = (c) => ({ programId: c.programId, network: c.network, name: 'gpl_session', json: c.json, hash: 'x', addedAt: 3 });
    nav.route = { name: 'settings/idls', addFor: ALICE } as never;
    renderScreen(<IdlManagerScreen />);
    const form = within(await screen.findByRole('region', { name: 'Add IDL' }));
    expect(form.getByLabelText('Program ID')).toHaveValue(ALICE);
    await user.click(form.getByLabelText('IDL JSON'));
    await user.paste(JSON.stringify({ metadata: { name: 'gpl_session' }, instructions: [] }));
    await user.click(form.getByRole('button', { name: 'Add IDL' }));
    await waitFor(() => expect(nav.back).toHaveBeenCalled());
    expect(api.calls.filter((c) => c.type === 'idls:add').at(-1)).toMatchObject({ programId: ALICE });
  });

  it('adds an IDL from pasted JSON, showing validation errors', async () => {
    const user = userEvent.setup();
    let reject = true;
    api.handlers['idls:add'] = (c) => {
      if (reject) throw new Error('IDL does not describe any instruction');
      idls = [...idls, { programId: c.programId as string, network: c.network as string, name: 'lending', json: c.json as string, hash: 'x', addedAt: 2 }];
      return idls.at(-1);
    };
    renderScreen(<IdlManagerScreen />);
    await screen.findByText('my_escrow');
    await user.click(screen.getByRole('button', { name: 'Add IDL' }));
    const form = within(screen.getByRole('region', { name: 'Add IDL' }));
    const json = form.getByLabelText('IDL JSON');
    await user.click(json);
    await user.paste('{not json');
    await user.click(form.getByRole('button', { name: 'Add IDL' }));
    expect(form.getByText('The IDL is not valid JSON')).toBeInTheDocument();
    expect(api.calls.some((c) => c.type === 'idls:add')).toBe(false);

    await user.clear(json);
    await user.click(json);
    await user.paste(JSON.stringify({ address: ALICE, metadata: { name: 'lending' }, instructions: [] }));
    await user.click(form.getByRole('button', { name: 'Add IDL' }));
    expect(await form.findByText('IDL does not describe any instruction')).toBeInTheDocument();

    reject = false;
    await user.click(form.getByRole('button', { name: 'Add IDL' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Add IDL' })).toBeNull());
    expect(await screen.findByText('lending')).toBeInTheDocument();
    const add = api.calls.filter((c) => c.type === 'idls:add').at(-1)!;
    expect(add).toMatchObject({ programId: ALICE, network: 'mainnet' });
    expect(JSON.parse(add.json as string).address).toBe(ALICE);
  });

  it('adds an IDL from a file and requires a program ID', async () => {
    const user = userEvent.setup();
    api.handlers['idls:add'] = () => ({});
    renderScreen(<IdlManagerScreen />);
    await screen.findByText('my_escrow');
    await user.click(screen.getByRole('button', { name: 'Add IDL' }));
    const form = within(screen.getByRole('region', { name: 'Add IDL' }));
    const file = new File([JSON.stringify({ instructions: [] })], 'idl.json', { type: 'application/json' });
    await user.upload(form.getByLabelText('Load from file'), file);
    await waitFor(() => expect(form.getByLabelText('IDL JSON')).toHaveValue('{"instructions":[]}'));
    await user.click(form.getByRole('button', { name: 'Add IDL' }));
    expect(form.getByText('Enter a valid program ID')).toBeInTheDocument();
    await user.type(form.getByLabelText('Program ID'), BOB);
    await user.click(within(form.getByRole('radiogroup', { name: 'IDL network' })).getByText('Devnet'));
    await user.click(form.getByRole('button', { name: 'Add IDL' }));
    await waitFor(() => expect(api.calls.some((c) => c.type === 'idls:add')).toBe(true));
    expect(api.calls.find((c) => c.type === 'idls:add')).toEqual({ type: 'idls:add', programId: BOB, network: 'devnet', json: '{"instructions":[]}' });
  });
});

describe('AddressBookScreen', () => {
  it('shows contacts and labels in tabs with counts', async () => {
    const user = userEvent.setup();
    renderScreen(<AddressBookScreen />);
    expect(await screen.findByRole('tab', { name: 'Contacts · 2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('sent 3x')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Account labels · 1' }));
    expect(screen.getByText('Escrow vault')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('adds a contact and rejects an invalid address', async () => {
    const user = userEvent.setup();
    renderScreen(<AddressBookScreen />);
    await screen.findByText('Alice');
    await user.click(screen.getByRole('button', { name: 'Add contact' }));
    const form = within(screen.getByRole('region', { name: 'New entry' }));
    await user.type(form.getByLabelText('Name'), 'Payroll');
    await user.type(form.getByLabelText('Address'), 'not-an-address');
    expect(form.getByText('Not a valid Solana address')).toBeInTheDocument();
    expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(form.getByLabelText('Address'));
    await user.type(form.getByLabelText('Address'), MAIN);
    await user.type(form.getByLabelText('Note (optional)'), 'monthly');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('tab', { name: 'Contacts · 3' })).toBeInTheDocument();
    expect(screen.getByText('Payroll')).toBeInTheDocument();
    expect(api.calls.find((c) => c.type === 'contacts:upsert')).toEqual({ type: 'contacts:upsert', address: MAIN, name: 'Payroll', kind: 'contact', note: 'monthly' });
  });

  it('adds a label from the labels tab', async () => {
    const user = userEvent.setup();
    renderScreen(<AddressBookScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Account labels · 1' }));
    await user.click(screen.getByRole('button', { name: 'Add label' }));
    const form = within(screen.getByRole('region', { name: 'New entry' }));
    await user.type(form.getByLabelText('Name'), 'Cold');
    await user.type(form.getByLabelText('Address'), MAIN);
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('tab', { name: 'Account labels · 2' })).toBeInTheDocument();
    expect(api.calls.find((c) => c.type === 'contacts:upsert')).toMatchObject({ kind: 'label', name: 'Cold' });
  });

  it('edits and removes a contact', async () => {
    const user = userEvent.setup();
    renderScreen(<AddressBookScreen />);
    await user.click(await screen.findByRole('button', { name: 'Edit Alice' }));
    let form = within(screen.getByRole('region', { name: 'Edit entry' }));
    expect(form.getByLabelText('Address')).toHaveAttribute('readonly');
    await user.clear(form.getByLabelText('Name'));
    await user.type(form.getByLabelText('Name'), 'Alice B');
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Alice B')).toBeInTheDocument();
    expect(api.calls.find((c) => c.type === 'contacts:upsert')).toEqual({ type: 'contacts:upsert', address: ALICE, name: 'Alice B', kind: 'contact', note: 'sent 3x' });

    await user.click(screen.getByRole('button', { name: 'Edit Bob' }));
    form = within(screen.getByRole('region', { name: 'Edit entry' }));
    await user.click(form.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
    expect(api.calls.find((c) => c.type === 'contacts:remove')).toEqual({ type: 'contacts:remove', address: BOB });
    expect(screen.getByRole('tab', { name: 'Contacts · 1' })).toBeInTheDocument();
  });
});

describe('NetworkRpcScreen', () => {
  it('shows the networks with latency and DAS on the active one', async () => {
    renderScreen(<NetworkRpcScreen />);
    const mainnet = await screen.findByRole('radio', { name: /Mainnet/ });
    expect(mainnet).toBeChecked();
    const row = within(mainnet.closest('label')!);
    expect(row.getByText('rpc.example.com')).toBeInTheDocument();
    expect(await row.findByText('84 ms')).toBeInTheDocument();
    expect(await row.findByText('DAS')).toBeInTheDocument();
    expect(within(screen.getByRole('radio', { name: /Devnet/ }).closest('label')!).getByText('api.devnet.solana.com')).toBeInTheDocument();
    expect(within(screen.getByRole('radio', { name: /Local/ }).closest('label')!).getByText('127.0.0.1:8899')).toBeInTheDocument();
    expect(screen.getAllByText(/\d+ ms/)).toHaveLength(1);
  });

  it('probes health once for the whole screen, not once per network row', async () => {
    api.state.settings = { ...api.state.settings, network: 'custom', rpcUrl: 'https://custom.example.com', customRpcs: [{ url: 'https://custom.example.com', cluster: 'mainnet' }] };
    renderScreen(<NetworkRpcScreen />);
    expect(await screen.findAllByRole('radio')).toHaveLength(4);
    expect(await screen.findByText('84 ms')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(getHealth).toHaveBeenCalledTimes(1);
  });

  it('switches network with the default RPC', async () => {
    const user = userEvent.setup();
    renderScreen(<NetworkRpcScreen />);
    await user.click(await screen.findByRole('radio', { name: /Devnet/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Devnet/ })).toBeChecked());
    await user.click(screen.getByRole('radio', { name: /Local/ }));
    expect(patches()).toEqual([
      { network: 'devnet', rpcUrl: DEFAULT_RPC.devnet },
      { network: 'localnet', rpcUrl: DEFAULT_RPC.localnet },
    ]);
  });

  it('validates and saves a custom RPC', async () => {
    const user = userEvent.setup();
    renderScreen(<NetworkRpcScreen />);
    await user.click(await screen.findByRole('button', { name: '+ Add custom RPC' }));
    const form = within(screen.getByRole('region', { name: 'Custom RPC' }));
    await user.type(form.getByLabelText('Custom RPC URL'), 'rpc.example.org');
    await user.click(form.getByRole('button', { name: 'Use this RPC' }));
    expect(form.getByText('Enter a full URL, like https://rpc.example.com')).toBeInTheDocument();
    await user.clear(form.getByLabelText('Custom RPC URL'));
    await user.type(form.getByLabelText('Custom RPC URL'), 'http://rpc.example.org');
    await user.click(form.getByRole('button', { name: 'Use this RPC' }));
    expect(form.getByText('RPC URL must use https (http only for localhost)')).toBeInTheDocument();
    expect(patches()).toEqual([]);

    await user.clear(form.getByLabelText('Custom RPC URL'));
    await user.type(form.getByLabelText('Custom RPC URL'), 'https://devnet.helius.example/?k=1');
    await user.click(within(form.getByRole('radiogroup', { name: 'Cluster served by the custom RPC' })).getByText('Devnet'));
    await user.click(form.getByRole('button', { name: 'Use this RPC' }));
    expect(patches()).toEqual([{ network: 'custom', rpcUrl: 'https://devnet.helius.example/?k=1', customCluster: 'devnet' }]);
  });

  it('lists every saved custom RPC by host, switches to one, and removes one not in use', async () => {
    const user = userEvent.setup();
    const customRpcs = [
      { url: 'https://a.helius.example/?api-key=secret', cluster: 'mainnet' },
      { url: 'https://b.example/devnet', cluster: 'devnet' },
    ];
    api.state.settings = { ...api.state.settings, network: 'custom', rpcUrl: customRpcs[0]!.url, customRpcs };
    renderScreen(<NetworkRpcScreen />);
    const a = await screen.findByRole('radio', { name: 'Custom RPC a.helius.example · Mainnet' });
    expect(a).toBeChecked();
    expect(screen.queryByText(/secret/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove a.helius.example · Mainnet' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Custom RPC b.example · Devnet' }));
    expect(patches()).toEqual([{ network: 'custom', rpcUrl: 'https://b.example/devnet', customCluster: 'devnet' }]);
  });

  it('removes a saved custom RPC that is not in use', async () => {
    const user = userEvent.setup();
    const customRpcs = [
      { url: 'https://a.example', cluster: 'mainnet' },
      { url: 'https://b.example', cluster: 'devnet' },
    ];
    api.state.settings = { ...api.state.settings, network: 'custom', rpcUrl: customRpcs[0]!.url, customRpcs };
    renderScreen(<NetworkRpcScreen />);
    await user.click(await screen.findByRole('button', { name: 'Remove b.example · Devnet' }));
    expect(patches()).toEqual([{ customRpcs: [customRpcs[0]] }]);
    expect(screen.getByRole('radio', { name: 'Custom RPC a.example · Mainnet' })).toBeChecked();
  });

  it('toggles the header network switch and the devnet tint', async () => {
    const user = userEvent.setup();
    renderScreen(<NetworkRpcScreen />);
    await user.click(await screen.findByRole('switch', { name: /Network picker on the home screen/ }));
    await user.click(screen.getByRole('switch', { name: /Tint the wallet on test networks/ }));
    expect(patches()).toEqual([{ networkSwitchInHeader: false }, { devnetTint: false }]);
  });
});

describe('SecurityScreen', () => {
  const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';

  it('reveals the recovery phrase only with the right password', async () => {
    api.handlers['vault:revealMnemonic'] = (c) => {
      if (c.password !== 'correct horse') throw new Error('Wrong password');
      return { mnemonic: PHRASE };
    };
    const user = userEvent.setup();
    renderScreen(<SecurityScreen />);
    expect(screen.getByText('Anyone with this phrase owns your wallet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Recovery phrase' })).toBeNull();
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
    expect(await screen.findByText('Wrong password')).toBeInTheDocument();
    expect(screen.queryByText('abandon')).toBeNull();

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
    const words = await screen.findByRole('list', { name: 'Recovery phrase' });
    expect(within(words).getAllByRole('listitem')).toHaveLength(12);
    expect(within(words).getByText('accident')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide phrase' }));
    expect(screen.queryByText('accident')).toBeNull();
  });

  it('changes the password after validating the new one', async () => {
    api.handlers['vault:changePassword'] = (c) => {
      if (c.current !== 'old password') throw new Error('Wrong password');
      return {};
    };
    const user = userEvent.setup();
    renderScreen(<SecurityScreen />);
    const submit = screen.getByRole('button', { name: 'Change password' });
    await user.type(screen.getByLabelText('Current password'), 'old password');
    await user.type(screen.getByLabelText(/New password/), 'short');
    expect(screen.getByText('Too short')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/New password/));
    await user.type(screen.getByLabelText(/New password/), 'a much longer one');
    await user.type(screen.getByLabelText('Confirm new password'), 'a much longer on');
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Confirm new password'), 'e');
    await user.click(submit);
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(api.calls.find((c) => c.type === 'vault:changePassword')).toEqual({ type: 'vault:changePassword', current: 'old password', next: 'a much longer one' });
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('shows the service error for a wrong current password', async () => {
    api.handlers['vault:changePassword'] = () => {
      throw new Error('Wrong password');
    };
    const user = userEvent.setup();
    renderScreen(<SecurityScreen />);
    await user.type(screen.getByLabelText('Current password'), 'bad password');
    await user.type(screen.getByLabelText(/New password/), 'a much longer one');
    await user.type(screen.getByLabelText('Confirm new password'), 'a much longer one');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Change password' }));
    });
    expect(await screen.findByText('Wrong password')).toBeInTheDocument();
  });
});

describe('IdlViewScreen', () => {
  it('shows every instruction (args, accounts), account type and error of a curated IDL', async () => {
    const user = userEvent.setup();
    nav.route = { name: 'settings/idls/view', programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', network: 'mainnet', tier: 'curated' } as never;
    renderScreen(<IdlViewScreen />);
    const instructions = within(await screen.findByRole('region', { name: 'Instructions' }));
    expect(screen.getByRole('heading', { name: /Instructions · \d+/ })).toBeInTheDocument();
    await user.click(instructions.getByText('transferChecked'));
    const ix = within(instructions.getByText('transferChecked').closest('details')!);
    expect(ix.getByText('decimals')).toBeInTheDocument();
    expect(ix.getByText('u8')).toBeInTheDocument();
    expect(ix.getByText('authority')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Accounts' })).getAllByText('mint')[0]).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Errors · \d+/ })).toBeInTheDocument();
    expect(screen.getByText('Curated (bundled with Clef)')).toBeInTheDocument();
  });
});
