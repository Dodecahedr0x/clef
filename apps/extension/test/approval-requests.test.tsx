// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SQUADS_PROGRAM_ID } from '@clef/squads';
import { getAddressEncoder, getBase58Decoder, type Address } from '@solana/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hw = vi.hoisted(() => ({
  reconnect: vi.fn(),
  request: vi.fn(),
  keystoneSignRequest: vi.fn(),
  parseKeystoneSignature: vi.fn(),
  received: [] as string[],
}));

vi.mock('@clef/signers', () => {
  class HardwareError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  class UrFrameDecoder {
    frames: string[] = [];
    receive(f: string) {
      hw.received.push(f);
      if (!this.frames.includes(f)) this.frames.push(f);
    }
    progress() {
      return this.frames.length / 2;
    }
    isComplete() {
      return this.frames.length >= 2;
    }
    result() {
      return { type: 'sol-signature', cbor: new Uint8Array([9, 9]) };
    }
  }
  return {
    HardwareError,
    UrFrameDecoder,
    LedgerDevice: { reconnect: hw.reconnect, request: hw.request },
    keystoneSignRequest: hw.keystoneSignRequest,
    parseKeystoneSignature: hw.parseKeystoneSignature,
    // stand-in: the message is the wire without its first (signature-count) byte
    transactionMessageBytes: (wire: Uint8Array) => wire.slice(1),
  };
});

vi.mock('../components', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  AnimatedQr: (p: { frames: string[]; size: number }) => <div data-testid="animated-qr" data-frames={p.frames.join('|')} data-size={p.size} />,
}));

const squads = vi.hoisted(() => ({ fetchMultisig: vi.fn() }));
vi.mock('@clef/squads', async (orig) => ({ ...(await orig<Record<string, unknown>>()), fetchMultisig: squads.fetchMultisig }));
vi.mock('../lib/clients', async (orig) => ({ ...(await orig<Record<string, unknown>>()), createClients: () => ({ chain: {}, portfolio: {}, jupiter: {} }) }));
const explainHook = vi.hoisted(() => ({ useExplainBatch: vi.fn() }));
vi.mock('../lib/hooks', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useExplainBatch: explainHook.useExplainBatch }));

import {
  BlockedSiteBanner,
  ConnectApproval,
  HardwareSignStep,
  MessageApproval,
  SignInApproval,
  SquadsApproval,
  type QrScanner,
} from '../entrypoints/approval/requests';

const MAIN = '7xKpQ2mVt8f2c41a9e7Rk4wXv9cJ9xQ2mVt3fQaB1cD' as Address;
const LEDGER = 'Ct4mN8kLp2Qr5sT7vW9xY1zA3bC5dE7fG9hJ2kQ8xe' as Address;
const KEYSTONE = 'Ks7nP3qR5tV7xZ9bD2fH4kM6pS8uW1yA3cE5gJ7mN9q' as Address;
const VAULT = 'Sq4vR2tY6uI8oP1aS3dF5gH7jK9lZ2xC4vB6nM8Lm8P' as Address;
const MULTISIG = 'Ms1gT3yU5iO7pA9sD2fG4hJ6kL8zX1cV3bN5mQ7wE9r' as Address;
const ALICE = 'A1icE3rT5yU7iO9pA2sD4fG6hJ8kL1zX3cV5bN7mQ9w' as Address;
const SIG = new Uint8Array(64).fill(7);

const state = {
  hasVault: true,
  unlocked: true,
  accounts: [
    { kind: 'hd', address: MAIN, label: 'Main', index: 0 },
    { kind: 'ledger', address: LEDGER, label: 'Ledger 1', path: "44'/501'/0'" },
    { kind: 'keystone', address: KEYSTONE, label: 'Keystone vault', path: "m/44'/501'/0'", xfp: 'f23f9fd2' },
    { kind: 'squads', address: VAULT, label: 'Treasury', multisig: MULTISIG, vaultIndex: 0, member: LEDGER },
    { kind: 'watch', address: ALICE, label: 'Watched' },
  ],
  settings: { network: 'mainnet', rpcUrl: 'https://api.mainnet-beta.solana.com', detailLevel: 'basic' },
  permissions: [],
  activeAccount: MAIN,
  errorReportsAvailable: false,
} as never;

const ledgerSigner = { kind: 'ledger', address: LEDGER, path: "44'/501'/0'" } as const;
const keystoneSigner = { kind: 'keystone', address: KEYSTONE, path: "m/44'/501'/0'", xfp: 'f23f9fd2' } as const;

/** A minimal legacy transaction: 1 signature slot, 2 keys, 1 instruction. */
function legacyTx(): Uint8Array {
  return new Uint8Array([1, ...new Array(64).fill(0), 1, 0, 1, 2, ...new Array(32).fill(1), ...new Array(32).fill(2), ...new Array(32).fill(3), 1, 1, 0, 0]);
}

async function hashGroups(message: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', message as BufferSource));
  return getBase58Decoder().decode(digest).match(/.{1,4}/g)!.join(' ');
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  hw.received.length = 0;
});

describe('BlockedSiteBanner', () => {
  it('names the phishing list match', () => {
    render(<BlockedSiteBanner hit={{ reason: 'fuzzy', match: 'jup.ag' }} />);
    expect(screen.getByText('This site is on a phishing list')).toBeTruthy();
    expect(screen.getByText(/looks like jup\.ag/)).toBeTruthy();
  });
});

describe('ConnectApproval', () => {
  const request = { kind: 'connect', origin: 'https://jup.ag', phishing: null } as const;

  it('lists signing accounts with hardware/squads tags and what the site can and cannot do', () => {
    const onDecide = vi.fn();
    render(<ConnectApproval request={request} state={state} onDecide={onDecide} />);
    expect(screen.getByRole('heading', { name: 'jup.ag wants to connect' })).toBeTruthy();
    expect(screen.getByText('https://jup.ag')).toBeTruthy();
    expect(screen.getByText('Not on phishing lists · first visit')).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Main/ })).toHaveProperty('checked', true);
    expect(screen.queryByRole('radio', { name: /Watched/ })).toBeNull();
    expect(within(screen.getByRole('radio', { name: /Ledger 1/ }).closest('label')!).getByText('Ledger')).toBeTruthy();
    expect(within(screen.getByRole('radio', { name: /Keystone vault/ }).closest('label')!).getByText('Keystone')).toBeTruthy();
    expect(within(screen.getByRole('radio', { name: /Treasury/ }).closest('label')!).getByText('Squads')).toBeTruthy();
    expect(screen.getByText('See this account’s address and balances')).toBeTruthy();
    expect(screen.getByText('Ask you to sign — every request comes back here')).toBeTruthy();
    expect(screen.getByText('Move funds without your approval')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /Ledger 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onDecide).toHaveBeenCalledWith({ approved: true, accounts: [LEDGER] });
  });

  it('cancel rejects; a previously connected site is not a first visit', () => {
    const onDecide = vi.fn();
    const known = { ...(state as object), permissions: [{ origin: 'https://jup.ag', accounts: [MAIN], connectedAt: 1 }] } as never;
    render(<ConnectApproval request={request} state={known} onDecide={onDecide} />);
    expect(screen.getByText('Not on phishing lists · connected before')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDecide).toHaveBeenCalledWith({ approved: false });
  });

  it('phishing hit: banner, and Connect stays disabled until acknowledged', () => {
    const onDecide = vi.fn();
    render(<ConnectApproval request={{ ...request, origin: 'https://jup-ag.claim.example', phishing: { reason: 'blocklist', match: 'jup-ag.claim.example' } }} state={state} onDecide={onDecide} />);
    expect(screen.getByText('This site is on a phishing list')).toBeTruthy();
    expect(screen.queryByText(/Not on phishing lists/)).toBeNull();
    const connect = screen.getByRole('button', { name: 'Connect anyway' }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.click(connect);
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this site is on a phishing list' }));
    expect(connect.disabled).toBe(false);
    fireEvent.click(connect);
    expect(onDecide).toHaveBeenCalledWith({ approved: true, accounts: [MAIN] });
  });
});

describe('MessageApproval', () => {
  const text = 'Welcome to Forum!\nSign to prove you own this wallet.\n\nNonce: 8f2c41a9e7';
  const message = new TextEncoder().encode(text);
  const request = { kind: 'signMessage', origin: 'https://forum.example', phishing: null, account: MAIN, message, signer: { kind: 'software' } } as const;

  it('shows readable text, toggles to hex, and signs', () => {
    const onDecide = vi.fn();
    render(<MessageApproval request={request} state={state} onDecide={onDecide} />);
    expect(screen.getByText('forum.example')).toBeTruthy();
    expect(screen.getByText('Requests a message signature · Main')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sign a message' })).toBeTruthy();
    expect(screen.getByText(`UTF-8 text · ${message.length} bytes`)).toBeTruthy();
    expect(screen.getByText(/Nonce: 8f2c41a9e7/)).toBeTruthy();
    expect(screen.getByText('Readable text — not a hidden transaction')).toBeTruthy();
    expect(screen.getByText('Signing a message can’t move funds by itself')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hex' }));
    expect(screen.getByRole('button', { name: 'Hex' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/57 65 6c 63 6f 6d 65/)).toBeTruthy();
    expect(screen.queryByText(/Nonce: 8f2c41a9e7/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    expect(onDecide).toHaveBeenCalledWith({ approved: true });
  });

  it('a message that decodes as a transaction is blocked outright', () => {
    const onDecide = vi.fn();
    render(<MessageApproval request={{ ...request, message: legacyTx() }} state={state} onDecide={onDecide} />);
    expect(screen.getByText('This message is a Solana transaction')).toBeTruthy();
    expect(screen.queryByText('Readable text — not a hidden transaction')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    const sign = screen.getByRole('button', { name: 'Sign' }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    fireEvent.click(sign);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith({ approved: false });
  });

  it('hardware signer: signs through onSign and forwards signatures', async () => {
    const onDecide = vi.fn();
    const onSign = vi.fn().mockResolvedValue([SIG]);
    render(<MessageApproval request={{ ...request, account: LEDGER, signer: ledgerSigner }} state={state} onDecide={onDecide} onSign={onSign} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ approved: true, signatures: [SIG] }));
    expect(onSign).toHaveBeenCalledWith([message]);
  });
});

describe('SignInApproval', () => {
  const now = Date.now();
  const input = {
    domain: 'jup.ag',
    address: MAIN,
    statement: 'Sign in to Jupiter',
    uri: 'https://jup.ag',
    version: '1',
    chainId: 'solana:mainnet',
    nonce: 'k3J9xQ2mVt',
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + 10 * 60_000 + 5_000).toISOString(),
  };
  const request = { kind: 'signIn', origin: 'https://jup.ag', phishing: null, account: MAIN, input, signer: { kind: 'software' } } as const;

  it('shows parsed fields with domain and address checks', () => {
    const onDecide = vi.fn();
    render(<SignInApproval request={request} state={state} onDecide={onDecide} />);
    expect(screen.getByRole('heading', { name: 'Sign in to jup.ag' })).toBeTruthy();
    const dl = screen.getByText('Domain').closest('dl')!;
    expect(within(dl).getByText('✓ matches tab')).toBeTruthy();
    expect(within(dl).getByText('✓ yours')).toBeTruthy();
    expect(within(dl).getByText('Sign in to Jupiter')).toBeTruthy();
    expect(within(dl).getByText('Mainnet')).toBeTruthy();
    expect(within(dl).getByText('in 10 minutes')).toBeTruthy();
    expect(within(dl).getByText('k3J9xQ2mVt')).toBeTruthy();
    expect(screen.getByText('Signing in proves you own this address. It doesn’t approve any transaction.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onDecide).toHaveBeenCalledWith({ approved: true });
  });

  it('a domain that does not match the tab blocks sign-in', () => {
    const onDecide = vi.fn();
    render(<SignInApproval request={{ ...request, input: { ...input, domain: 'evil.example' } }} state={state} onDecide={onDecide} />);
    expect(screen.getByText('✕ not this site')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('an address that is not yours is flagged and blocks sign-in', () => {
    render(<SignInApproval request={{ ...request, input: { ...input, address: ALICE } }} state={state} onDecide={vi.fn()} />);
    expect(screen.getByText('✕ not this account')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('without a requested account, the user picks one and hardware signs the SIWS bytes', async () => {
    const onDecide = vi.fn();
    const onSign = vi.fn().mockResolvedValue([SIG]);
    const { address: _omit, ...noAddress } = input;
    render(<SignInApproval request={{ ...request, account: null, signer: null, input: noAddress }} state={state} onDecide={onDecide} onSign={onSign} />);
    fireEvent.click(screen.getByRole('radio', { name: /Ledger 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ approved: true, account: LEDGER, signatures: [SIG] }));
    const [payloads, signer] = onSign.mock.calls[0]!;
    expect(signer).toEqual(ledgerSigner);
    expect(new TextDecoder().decode(payloads[0])).toContain(`jup.ag wants you to sign in with your Solana account:\n${LEDGER}`);
  });
});

/** A legacy outer wire whose instructions are Squads instructions with the given discriminators (hex). */
function squadsWire(...discs: string[]): Uint8Array {
  const ixs = discs.flatMap((d) => [1, 0, 8, ...Buffer.from(d, 'hex')]);
  return new Uint8Array([1, ...new Array(64).fill(0), 1, 0, 1, 2, ...new Array(32).fill(5), ...getAddressEncoder().encode(SQUADS_PROGRAM_ID), ...new Array(32).fill(9), discs.length, ...ixs]);
}
const SQ = {
  create: '30fa4ea8d0e2dad3',
  propose: 'dc3c49e01e6c4f9f',
  approve: '9025a488bcd82af8',
  bufferCreate: 'f5c9716c253f1d59',
  bufferExtend: 'e69d433805eef592',
  bufferClose: '11b6d0e48818b266',
  fromBuffer: 'de36954457f630e7',
};

describe('SquadsApproval', () => {
  const inner = new Uint8Array([1, 2, 3]);
  const proposal = squadsWire(SQ.create, SQ.propose, SQ.approve);
  const request = { kind: 'squadsPropose', origin: 'https://payroll.example', phishing: null, account: VAULT, multisig: MULTISIG, vaultIndex: 0, member: LEDGER, inner, proposals: [proposal] as Uint8Array[], signer: ledgerSigner } as const;

  beforeEach(() => {
    explainHook.useExplainBatch.mockReturnValue({
      status: 'ok',
      batch: {},
      view: { combined: { summary: 'Send 500 USDC to Pr7y…Kd2W', balanceChanges: [{ owner: VAULT, asset: 'USDC', amount: '-500' }], warnings: [], fee: null, computeUnits: null, accountDiffs: null, incomplete: false } },
    });
    squads.fetchMultisig.mockResolvedValue({
      address: MULTISIG,
      threshold: 2,
      members: [
        { key: LEDGER, initiate: true, vote: true, execute: true },
        { key: ALICE, initiate: true, vote: true, execute: true },
        { key: MAIN, initiate: false, vote: true, execute: false },
      ],
      transactionIndex: 4n,
      staleTransactionIndex: 0n,
      timeLock: 0,
    });
  });

  it('shows what the vault will do, what you sign now, and approval progress', async () => {
    const onDecide = vi.fn();
    const onSign = vi.fn().mockResolvedValue([SIG]);
    render(<SquadsApproval request={request} state={state} onDecide={onDecide} onSign={onSign} />);
    expect(explainHook.useExplainBatch).toHaveBeenCalledWith([inner], 'basic');
    expect(screen.getByRole('heading', { name: 'Propose: Send 500 USDC to Pr7y…Kd2W' })).toBeTruthy();
    expect(screen.getByText('Request from payroll.example · you sign as Ledger 1')).toBeTruthy();
    expect(screen.getByText('When executed, the vault will')).toBeTruthy();
    expect(screen.getByText('-500 USDC')).toBeTruthy();
    expect(screen.getByText('What you sign now')).toBeTruthy();
    for (const ix of ['vault_transaction_create', 'proposal_create', 'proposal_approve']) expect(screen.getByText(ix)).toBeTruthy();

    expect(await screen.findByText('Treasury · Squads 2 of 3')).toBeTruthy();
    expect(screen.getByText('✓ member · can vote')).toBeTruthy();
    expect(screen.getByText('1 of 2 after you sign')).toBeTruthy();
    const approvals = screen.getByRole('list', { name: 'Members' });
    expect(within(approvals).getByText('Ledger 1 (you)')).toBeTruthy();
    expect(within(approvals).getByText('approves now')).toBeTruthy();
    expect(within(approvals).getAllByText('pending')).toHaveLength(2);
    expect(within(approvals).getByText('Main')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Propose & approve' }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ approved: true, signatures: [SIG] }));
    expect(onSign).toHaveBeenCalledWith([proposal]);
    expect(screen.queryByText(/transaction buffer/)).toBeNull();
    expect(screen.queryByText(/ephemeral signer/)).toBeNull();
  });

  it('a buffered proposal with an extra signer: lists every outer instruction, explains why, signs all on the device', async () => {
    const vault = getBase58Decoder().decode(new Uint8Array(32).fill(5)) as Address;
    // legacy wire: 2 signers (vault, a fresh account), system program; one createAccount-like instruction
    const twoSigners = new Uint8Array([2, ...new Array(128).fill(0), 2, 0, 1, 3, ...new Array(32).fill(5), ...new Array(32).fill(6), ...new Array(32).fill(0), ...new Array(32).fill(7), 1, 2, 2, 0, 1, 0]);
    const outer = [squadsWire(SQ.bufferCreate), squadsWire(SQ.bufferExtend), squadsWire(SQ.bufferExtend), squadsWire(SQ.fromBuffer, SQ.propose, SQ.approve)];
    const onDecide = vi.fn();
    const onSign = vi.fn().mockResolvedValue([SIG, SIG, SIG, SIG]);
    render(<SquadsApproval request={{ ...request, account: vault, inner: twoSigners, proposals: outer }} state={state} onDecide={onDecide} onSign={onSign} />);
    for (const ix of ['transaction_buffer_create', 'transaction_buffer_extend ×2', 'vault_transaction_create_from_buffer', 'proposal_create', 'proposal_approve']) expect(screen.getByText(ix)).toBeTruthy();
    expect(screen.getByText('You sign 4 transactions, sent one after another.')).toBeTruthy();
    expect(screen.getByText(/too large for one transaction, so Clef uploads it to a Squads transaction buffer first/)).toBeTruthy();
    expect(screen.queryByText(/resumes an upload/)).toBeNull();
    expect(screen.queryByText(/closes a transaction buffer/)).toBeNull();
    expect(screen.getByText(/1 extra signer\. The multisig signs for it with an ephemeral signer/)).toBeTruthy();
    expect(await screen.findByText('✓ member · can vote')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Propose & approve' }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ approved: true, signatures: [SIG, SIG, SIG, SIG] }));
    expect(onSign).toHaveBeenCalledWith(outer);
  });

  const signList = () => Array.from(screen.getByText('What you sign now').parentElement!.querySelectorAll('li'), (li) => li.textContent);

  it('a resumed upload lists only what is left: create from buffer, propose, approve', async () => {
    render(<SquadsApproval request={{ ...request, proposals: [squadsWire(SQ.fromBuffer, SQ.propose, SQ.approve)] }} state={state} onDecide={vi.fn()} onSign={vi.fn()} />);
    expect(signList()).toEqual(['vault_transaction_create_from_buffer', 'proposal_create', 'proposal_approve · your vote']);
    expect(screen.getByText('Clef resumes an upload an earlier attempt left unfinished.')).toBeTruthy();
    expect(screen.queryByText(/You sign \d+ transactions/)).toBeNull();
    expect(await screen.findByText('✓ member · can vote')).toBeTruthy();
  });

  it('close-then-restart lists the buffer close first', async () => {
    const proposals = [squadsWire(SQ.bufferClose), squadsWire(SQ.bufferCreate), squadsWire(SQ.bufferExtend), squadsWire(SQ.fromBuffer, SQ.propose, SQ.approve)];
    render(<SquadsApproval request={{ ...request, proposals }} state={state} onDecide={vi.fn()} onSign={vi.fn()} />);
    expect(signList()).toEqual(['transaction_buffer_close', 'transaction_buffer_create', 'transaction_buffer_extend', 'vault_transaction_create_from_buffer', 'proposal_create', 'proposal_approve · your vote']);
    expect(screen.getByText(/first closes a transaction buffer an earlier attempt left behind/)).toBeTruthy();
    expect(screen.getByText(/uploads it to a Squads transaction buffer first/)).toBeTruthy();
    expect(await screen.findByText('✓ member · can vote')).toBeTruthy();
  });

  it('a member without vote permission cannot propose', async () => {
    squads.fetchMultisig.mockResolvedValue({ address: MULTISIG, threshold: 2, members: [{ key: LEDGER, initiate: true, vote: false, execute: false }], transactionIndex: 1n, staleTransactionIndex: 0n, timeLock: 0 });
    render(<SquadsApproval request={request} state={state} onDecide={vi.fn()} />);
    expect(await screen.findByText('✕ cannot propose and vote')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Propose & approve' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('HardwareSignStep · Ledger', () => {
  const wire = legacyTx();
  function device(over: Partial<Record<string, unknown>> = {}) {
    return {
      getAppConfig: vi.fn().mockResolvedValue({ version: '1.10.1', blindSigningEnabled: true }),
      getAddress: vi.fn().mockResolvedValue(LEDGER),
      signTransaction: vi.fn().mockResolvedValue(SIG),
      signMessage: vi.fn().mockResolvedValue(SIG),
      close: vi.fn().mockResolvedValue(undefined),
      ...over,
    };
  }
  const err = (code: string) => Object.assign(new Error(code), { code });

  it('walks the steps, shows the blind-signing hash, and returns the signature', async () => {
    const dev = device();
    hw.reconnect.mockResolvedValue(dev);
    const onSigned = vi.fn();
    let resolveSign!: (s: Uint8Array) => void;
    dev.signTransaction.mockReturnValue(new Promise((r) => (resolveSign = r)));
    render(<HardwareSignStep signer={ledgerSigner} accountLabel="Ledger 1" payloads={[wire]} payloadKind="transaction" origin="https://jup.ag" summary="Swap 1.5 SOL → ~212.4 USDC" onSigned={onSigned} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Confirm on your Ledger' })).toBeTruthy();
    expect(screen.getByText('Swap 1.5 SOL → ~212.4 USDC')).toBeTruthy();
    expect(screen.getByText('jup.ag · Ledger 1')).toBeTruthy();
    expect(await screen.findByText('Waiting for approval on device…')).toBeTruthy();
    expect(screen.getByText('Connected over USB')).toBeTruthy();
    expect(screen.getByText('Solana app open')).toBeTruthy();
    expect(screen.getByText('v1.10.1')).toBeTruthy();
    expect(screen.getByText('Address matches Ledger 1')).toBeTruthy();
    expect(screen.getByText("44'/501'/0'")).toBeTruthy();
    expect(await screen.findByText(await hashGroups(wire.slice(1)))).toBeTruthy();
    expect(dev.getAddress).toHaveBeenCalledWith("44'/501'/0'");
    expect(dev.signTransaction).toHaveBeenCalledWith("44'/501'/0'", wire.slice(1));
    await act(async () => resolveSign(SIG));
    await waitFor(() => expect(onSigned).toHaveBeenCalledWith([SIG]));
  });

  it('rejected on device: shows the error and retries', async () => {
    const dev = device();
    dev.signMessage.mockRejectedValueOnce(err('rejected')).mockResolvedValueOnce(SIG);
    hw.reconnect.mockResolvedValue(dev);
    const onSigned = vi.fn();
    const msg = new TextEncoder().encode('hello');
    render(<HardwareSignStep signer={ledgerSigner} payloads={[msg]} payloadKind="message" origin="https://forum.example" summary="Sign a message" onSigned={onSigned} onCancel={vi.fn()} />);
    expect(await screen.findByText('You rejected it on the Ledger')).toBeTruthy();
    expect(screen.queryByText(/Your Ledger may show a hash/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledWith([SIG]));
    expect(dev.signMessage).toHaveBeenCalledTimes(2);
    expect(dev.signMessage).toHaveBeenCalledWith("44'/501'/0'", msg);
  });

  it('locked device: asks to unlock, retry succeeds', async () => {
    const dev = device();
    dev.getAppConfig.mockRejectedValueOnce(err('locked'));
    hw.reconnect.mockResolvedValue(dev);
    const onSigned = vi.fn();
    render(<HardwareSignStep signer={ledgerSigner} payloads={[wire]} payloadKind="transaction" origin="https://jup.ag" summary="Swap" onSigned={onSigned} onCancel={vi.fn()} />);
    expect(await screen.findByText('Unlock your Ledger')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledWith([SIG]));
  });

  it('wrong device address fails closed', async () => {
    hw.reconnect.mockResolvedValue(device({ getAddress: vi.fn().mockResolvedValue(MAIN) }));
    const onSigned = vi.fn();
    render(<HardwareSignStep signer={ledgerSigner} payloads={[wire]} payloadKind="transaction" origin="https://jup.ag" summary="Swap" onSigned={onSigned} onCancel={vi.fn()} />);
    expect(await screen.findByText('This Ledger holds a different account')).toBeTruthy();
    expect(onSigned).not.toHaveBeenCalled();
  });

  it('no granted device: Connect Ledger opens the chooser; Cancel cancels', async () => {
    hw.reconnect.mockResolvedValue(null);
    hw.request.mockResolvedValue(device());
    const onSigned = vi.fn();
    const onCancel = vi.fn();
    render(<HardwareSignStep signer={ledgerSigner} payloads={[wire, wire]} payloadKind="transaction" origin="https://jup.ag" summary="Swap" onSigned={onSigned} onCancel={onCancel} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Ledger' }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledWith([SIG, SIG]));
    expect(hw.request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('HardwareSignStep · Keystone', () => {
  it('shows the sign request as an animated QR, scans the signature back, and returns it', async () => {
    const wire = legacyTx();
    const frames = ['ur:sol-sign-request/1-3/aaa', 'ur:sol-sign-request/2-3/bbb', 'ur:sol-sign-request/3-3/ccc'];
    hw.keystoneSignRequest.mockReturnValue({ requestId: 'req-1', frames });
    hw.parseKeystoneSignature.mockReturnValue(SIG);
    let emit!: (t: string) => void;
    const stop = vi.fn();
    const scanner: QrScanner = {
      start: vi.fn(async (_video, onText) => {
        emit = onText;
        return stop;
      }),
    };
    const onSigned = vi.fn();
    render(<HardwareSignStep signer={keystoneSigner} accountLabel="Keystone vault" payloads={[wire]} payloadKind="transaction" origin="https://jup.ag" summary="Swap 1.5 SOL → ~212.4 USDC" onSigned={onSigned} onCancel={vi.fn()} scanner={scanner} />);

    expect(screen.getByText('jup.ag · Keystone vault')).toBeTruthy();
    expect(hw.keystoneSignRequest).toHaveBeenCalledWith({ data: wire.slice(1), kind: 'transaction', path: "m/44'/501'/0'", xfp: 'f23f9fd2', address: KEYSTONE, origin: 'https://jup.ag' });
    const qr = screen.getByTestId('animated-qr');
    expect(qr.getAttribute('data-frames')).toBe(frames.join('|'));
    expect(screen.getByText('1 · Keystone scans this').getAttribute('aria-current')).toBe('step');

    fireEvent.click(screen.getByRole('button', { name: 'Scan signature' }));
    expect(screen.getByText('2 · Clef scans the signature').getAttribute('aria-current')).toBe('step');
    await waitFor(() => expect(scanner.start).toHaveBeenCalled());
    await act(async () => emit('ur:sol-signature/1-2/xx'));
    expect(screen.getByText('Scanning… 50%')).toBeTruthy();
    await act(async () => emit('ur:sol-signature/2-2/yy'));
    await waitFor(() => expect(onSigned).toHaveBeenCalledWith([SIG]));
    expect(hw.received).toEqual(['ur:sol-signature/1-2/xx', 'ur:sol-signature/2-2/yy']);
    expect(hw.parseKeystoneSignature).toHaveBeenCalledWith({ type: 'sol-signature', cbor: new Uint8Array([9, 9]) }, 'req-1');
    expect(stop).toHaveBeenCalled();
  });

  it('a signature for another request shows an error and lets you scan again', async () => {
    hw.keystoneSignRequest.mockReturnValue({ requestId: 'req-2', frames: ['ur:x/1-1/a'] });
    hw.parseKeystoneSignature.mockImplementationOnce(() => {
      throw new Error('request id mismatch');
    });
    let emit!: (t: string) => void;
    const scanner: QrScanner = { start: vi.fn(async (_v, onText) => ((emit = onText), () => {})) };
    const onSigned = vi.fn();
    render(<HardwareSignStep signer={keystoneSigner} payloads={[new Uint8Array([1, 2])]} payloadKind="message" origin="https://forum.example" summary="Sign a message" onSigned={onSigned} onCancel={vi.fn()} scanner={scanner} />);
    expect(hw.keystoneSignRequest).toHaveBeenCalledWith(expect.objectContaining({ data: new Uint8Array([1, 2]), kind: 'message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan signature' }));
    await waitFor(() => expect(scanner.start).toHaveBeenCalled());
    await act(async () => {
      emit('a');
      emit('b');
    });
    expect(await screen.findByText(/That QR is not the signature for this request/)).toBeTruthy();
    expect(onSigned).not.toHaveBeenCalled();
    hw.parseKeystoneSignature.mockReturnValue(SIG);
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(scanner.start).toHaveBeenCalledTimes(2));
    await act(async () => {
      emit('c');
      emit('d');
    });
    await waitFor(() => expect(onSigned).toHaveBeenCalledWith([SIG]));
  });
});
