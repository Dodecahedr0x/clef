import type { BatchView } from '@clef/explain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ facts: new Map<string, { symbol?: string; verified: boolean; usdPrice?: number }>() }));
vi.mock('../lib/hooks', () => ({ useTokenFacts: () => hooks.facts }));

import { BasicBody } from '../entrypoints/approval/tx/BasicBody';
import { displayAmount, usdOf } from '../entrypoints/approval/tx/model';
import { acknowledgeLabel, plainNames, Recipient } from '../entrypoints/approval/tx/parts';
import { AddressBook } from '../entrypoints/approval/tx/source';

const ME = '7xKpWm5c9tZ3EGr2cTyhLh8kq4sUXcMcz1p4UhRf3fQa';
const TO = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const ODD = 'Fo1dEr7mGc1HvTqP2xQe6U8kd4WnRaBzLyNs3JtMpump';

describe('approval wording helpers', () => {
  it('asks the acknowledgement for the danger actually shown', () => {
    expect(acknowledgeLabel(['phishing'])).toBe('I understand this site is on a phishing list');
    expect(acknowledgeLabel(['phishing', 'delegation'])).toMatch(/phishing list and I may lose funds/);
    expect(acknowledgeLabel(['could-not-explain'])).toBe("I understand Clef can't show what this does");
    expect(acknowledgeLabel(['delegation'])).toBe('I understand I may lose these funds');
  });

  it('drops the IDL tier at Basic, keeping only what changes trust', () => {
    expect(plainNames('Calls Swap (curated IDL, JUP6…TaV4)')).toBe('Calls Swap');
    expect(plainNames('Calls Foo (authority IDL, 9Wfh…Kz2r)')).toBe('Calls Foo (unverified name)');
    expect(plainNames('Send 1 SOL to Alice (address book, 7xKX…sAsU)')).toBe('Send 1 SOL to Alice (your contact)');
  });

  it('groups digits, uses a real minus, and marks a rounded amount', () => {
    expect(displayAmount('-1234567.5')).toBe('−1,234,567.5');
    expect(displayAmount('+4821.455814', { round: true })).toBe('+4,821.4558…');
    expect(displayAmount('+0.000001234567', { round: true })).toBe('+0.0000012…');
    expect(displayAmount('-2500000 (raw units)')).toBe('−2,500,000 (raw units)');
  });

  it('values an amount in USD unless it is in raw units or unpriced', () => {
    expect(usdOf('-1,234.5', 2)).toBe(-2469);
    expect(usdOf('+3', undefined)).toBeNull();
    expect(usdOf('-2500000 (raw units)', 1)).toBeNull();
  });
});

describe('Recipient', () => {
  const withBook = (book: Record<string, { name: string; kind: 'account' | 'contact' | 'label' }>, address: string) =>
    render(
      <AddressBook.Provider value={(a) => book[a] ?? null}>
        <Recipient address={address} />
      </AddressBook.Provider>,
    );

  it('names a saved recipient and an own account', () => {
    withBook({ [TO]: { name: 'Alice', kind: 'contact' } }, TO);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText(/in your address book/)).toBeTruthy();
    expect(screen.getByRole('button', { name: `Copy ${TO}` })).toBeTruthy();
  });

  it('says when the address is new, so it can be checked', () => {
    withBook({ [ME]: { name: 'Main', kind: 'account' } }, TO);
    expect(screen.getByText(/not in your address book\. Check it matches/)).toBeTruthy();
  });
});

describe('Basic balance rows', () => {
  const view = (changes: { owner: string; asset: string; mint?: string; amount: string }[], over: Record<string, unknown> = {}) =>
    ({
      level: 'basic',
      mode: 'sequential',
      steps: [{ index: 0, status: 'simulated', title: 'x', view: null }],
      combined: { summary: 'Send 1 SOL', balanceChanges: changes, fee: '0.000005 SOL', warnings: [], ...over },
    }) as unknown as BatchView;

  it('names a curated token plainly with its USD value', () => {
    hooks.facts = new Map([[BONK, { verified: true, usdPrice: 0.00002 }]]);
    render(<BasicBody view={view([{ owner: ME, asset: 'Bonk', mint: BONK, amount: '+1000000' }])} warnings={[]} danger={false} />);
    expect(screen.getByText('+1,000,000 Bonk')).toBeTruthy();
    expect(screen.getByText('$20.00')).toBeTruthy();
    expect(screen.queryByText(/unverified/)).toBeNull();
  });

  it('shows a market name as unverified, with the mint to check', () => {
    hooks.facts = new Map([[ODD, { symbol: 'USDC', verified: false }]]);
    render(<BasicBody view={view([{ owner: ME, asset: 'Fo1d…pump', mint: ODD, amount: '-5' }])} warnings={[]} danger={false} />);
    expect(screen.getByText('−5 USDC')).toBeTruthy();
    expect(screen.getByText(/unverified/)).toBeTruthy();
    expect(screen.getByRole('button', { name: `Copy ${ODD}` })).toBeTruthy();
  });

  it('shows the recipient and a refundable deposit', () => {
    hooks.facts = new Map();
    render(
      <BasicBody
        view={view([{ owner: ME, asset: 'SOL', mint: 'SOL', amount: '-1' }], { recipient: TO, deposits: { count: 1, amount: '0.00203928 SOL' } })}
        warnings={[]}
        danger={false}
      />,
    );
    expect(screen.getByRole('button', { name: `Copy ${TO}` })).toBeTruthy();
    expect(screen.getByText('Account deposit (refundable)')).toBeTruthy();
    expect(screen.getByText('0.00203928 SOL')).toBeTruthy();
  });
});
