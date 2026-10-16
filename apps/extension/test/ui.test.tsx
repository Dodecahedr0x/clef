// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { encode } from 'uqr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as kit from '../components';
import {
  AddressText, Alert, AnimatedQr, ApprovalFrame, Avatar, Button, Card, CardHeader, Chips, DecisionFooter, DetailLevelSwitch, EmptyState, Icon,
  IconButton, ListGroup, ListRow, Logo, NetworkSwitch, PasswordField, Pill, PopupScreen, QrCode, SectionLabel, Segmented, Spinner, StepDots, Tabs,
  TextField, Toggle, Tooltip, Amount,
} from '../components';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ADDR = '7xKpWm2QdL9vHc4TrB8nYeX5uJ3kPs6AGf1zNq7R3fQa';

function matrixFromSvg(svg: Element): boolean[][] {
  const n = Number(svg.getAttribute('data-modules'));
  const m = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const d = svg.querySelector('path')!.getAttribute('d')!;
  for (const [, x, y] of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) m[Number(y)]![Number(x)] = true;
  return m;
}

describe('exports', () => {
  it('exposes every component pinned in the contract', () => {
    const names = ['Icon', 'Logo', 'Button', 'IconButton', 'Segmented', 'Tabs', 'Chips', 'Card', 'CardHeader', 'SectionLabel', 'ListGroup', 'ListRow', 'Pill',
      'Alert', 'Avatar', 'AddressText', 'Amount', 'TextField', 'PasswordField', 'Toggle', 'QrCode', 'AnimatedQr', 'StepDots', 'Tooltip', 'Spinner',
      'EmptyState', 'PopupScreen', 'ApprovalFrame', 'DetailLevelSwitch', 'NetworkSwitch', 'DecisionFooter'];
    for (const n of names) expect(typeof (kit as Record<string, unknown>)[n], n).toBe('function');
  });
});

describe('buttons and icons', () => {
  it('Button renders its label, icon and disabled state', () => {
    const onClick = vi.fn();
    render(<Button icon="copy" onClick={onClick}>Copy</Button>);
    const b = screen.getByRole('button', { name: 'Copy' });
    expect(b.querySelector('svg[data-icon="copy"]')).not.toBeNull();
    expect(b.getAttribute('type')).toBe('button');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
    cleanup();
    render(<Button disabled>Sign anyway</Button>);
    expect((screen.getByRole('button', { name: 'Sign anyway' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('IconButton is named by its label and is a 44px target by default', () => {
    render(<IconButton label="Settings" icon="settings" />);
    const b = screen.getByRole('button', { name: 'Settings' });
    expect(b.className).toContain('size-11');
  });

  it('Icon is decorative and Logo is a named image', () => {
    const { container } = render(<><Icon name="shield-check" /><Logo /><Logo staff size={96} /></>);
    expect(container.querySelector('svg[data-icon="shield-check"]')!.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getAllByRole('img', { name: 'Clef' })).toHaveLength(2);
  });
});

describe('Segmented', () => {
  function Harness() {
    const [v, setV] = useState<'a' | 'b' | 'c'>('b');
    return <Segmented ariaLabel="Level" value={v} onChange={setV} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]} />;
  }

  it('is a radiogroup with one checked, tabbable radio', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Level' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves selection and focus with arrow keys, wrapping, and Home/End', () => {
    render(<Harness />);
    const radio = (n: string) => screen.getByRole('radio', { name: n });
    radio('B').focus();
    fireEvent.keyDown(radio('B'), { key: 'ArrowRight' });
    expect(radio('C').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('C'));
    fireEvent.keyDown(radio('C'), { key: 'ArrowRight' });
    expect(radio('A').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radio('A'), { key: 'ArrowLeft' });
    expect(radio('C').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radio('C'), { key: 'Home' });
    expect(radio('A').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radio('A'), { key: 'End' });
    expect(radio('C').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radio('B'));
    expect(radio('B').getAttribute('aria-checked')).toBe('true');
  });

  it('DetailLevelSwitch and NetworkSwitch keep full accessible names when compact', () => {
    const onLevel = vi.fn();
    const onNet = vi.fn();
    render(<><DetailLevelSwitch compact value="basic" onChange={onLevel} /><NetworkSwitch compact value="mainnet" onChange={onNet} /></>);
    expect(screen.getByRole('radiogroup', { name: 'Detail level' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Intermediate' }));
    expect(onLevel).toHaveBeenCalledWith('intermediate');
    expect(screen.getByText('Inter.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Devnet' }));
    expect(onNet).toHaveBeenCalledWith('devnet');
    expect(screen.getByText('Dev')).toBeTruthy();
  });
});

describe('Tabs and Chips', () => {
  it('Tabs expose tablist/tab/aria-selected and arrow navigation', () => {
    function H() {
      const [v, setV] = useState<'tokens' | 'activity' | 'sites'>('tokens');
      return <Tabs ariaLabel="Portfolio sections" value={v} onChange={setV} tabs={[{ id: 'tokens', label: 'Tokens' }, { id: 'activity', label: 'Activity' }, { id: 'sites', label: 'Sites' }]} />;
    }
    render(<H />);
    expect(screen.getByRole('tablist', { name: 'Portfolio sections' })).toBeTruthy();
    const tokens = screen.getByRole('tab', { name: 'Tokens' });
    expect(tokens.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tokens, { key: 'ArrowRight' });
    const activity = screen.getByRole('tab', { name: 'Activity' });
    expect(activity.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(activity);
    fireEvent.keyDown(activity, { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tokens' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Sites' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Chips are pressed toggle buttons in a named group', () => {
    const onChange = vi.fn();
    render(<Chips ariaLabel="Filter" value="all" onChange={onChange} chips={[{ id: 'all', label: 'All' }, { id: 'sent', label: 'Sent' }]} />);
    within(screen.getByRole('group', { name: 'Filter' })).getByRole('button', { name: 'All', pressed: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sent', pressed: false }));
    expect(onChange).toHaveBeenCalledWith('sent');
  });
});

describe('form controls', () => {
  it('TextField labels its input and announces errors', () => {
    render(<TextField label="Recipient" mono error="Not a Solana address" defaultValue="x" trailing={<span>t</span>} />);
    const input = screen.getByLabelText('Recipient');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Not a Solana address');
  });

  it('PasswordField toggles visibility', () => {
    render(<PasswordField label="Password" defaultValue="secret" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.type).toBe('password');
  });

  it('Toggle is a named switch', () => {
    const onChange = vi.fn();
    render(<Toggle label="Hide spam tokens" description="Unverified tokens with no value" checked onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: /Hide spam tokens/ }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('QR', () => {
  it('QrCode draws exactly the uqr matrix of its value', () => {
    render(<QrCode value={ADDR} size={184} />);
    const svg = screen.getByRole('img', { name: 'QR code' });
    expect(matrixFromSvg(svg)).toEqual(encode(ADDR, { ecc: 'M', border: 0 }).data);
  });

  it('QrCode with a logo uses error correction H', () => {
    render(<QrCode value={`solana:${ADDR}`} size={184} logo label="QR code of your Main account address" />);
    const svg = screen.getByRole('img', { name: 'QR code of your Main account address' });
    expect(matrixFromSvg(svg)).toEqual(encode(`solana:${ADDR}`, { ecc: 'H', border: 0 }).data);
  });

  it('AnimatedQr cycles frames on its interval and loops', () => {
    vi.useFakeTimers();
    const frames = ['UR:SOL-SIGN-REQUEST/1-3/AAAA', 'UR:SOL-SIGN-REQUEST/2-3/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'UR:SOL-SIGN-REQUEST/3-3/CCCC'];
    render(<AnimatedQr frames={frames} size={232} intervalMs={100} />);
    const svg = () => screen.getByRole('img', { name: 'Animated QR code' });
    const sizes = new Set<string | null>();
    const seen: boolean[][][] = [];
    for (let i = 0; i < 3; i++) {
      expect(screen.getByText(`Part ${i + 1} of 3 · looping`)).toBeTruthy();
      sizes.add(svg().getAttribute('data-modules'));
      seen.push(matrixFromSvg(svg()));
      act(() => { vi.advanceTimersByTime(100); });
    }
    expect(screen.getByText('Part 1 of 3 · looping')).toBeTruthy();
    expect(sizes.size).toBe(1);
    const version = Math.max(...frames.map((f) => encode(f, { ecc: 'L', border: 0 }).version));
    frames.forEach((f, i) => expect(seen[i]).toEqual(encode(f, { ecc: 'L', border: 0, minVersion: version }).data));
  });
});

describe('display components', () => {
  it('Tooltip exposes its text as the description of the trigger', () => {
    render(<Tooltip tip="Account relationships"><a href="#rel" aria-label="Account relationships">r</a></Tooltip>);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Account relationships');
    expect(screen.getByRole('link').getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('AddressText renders short, full and grouped forms', () => {
    render(<><AddressText address={ADDR} /><AddressText address={ADDR} mode="groups" /></>);
    expect(screen.getByText('7xKp…3fQa').getAttribute('title')).toBe(ADDR);
    const grouped = screen.getByLabelText(ADDR);
    expect(grouped.textContent).toBe(ADDR.match(/.{1,4}/g)!.join(' '));
    expect(Array.from(grouped.querySelectorAll('strong')).map((s) => s.textContent)).toEqual(['7xKp', '3fQa']);
  });

  it('Alert, Pill, StepDots, Spinner, EmptyState, Amount, Avatar render accessibly', () => {
    render(
      <>
        <Alert severity="danger" label="DANGER" title="Owner change">Body</Alert>
        <Alert severity="info">Accepts SOL</Alert>
        <Pill tone="ok">DAS</Pill>
        <StepDots total={3} current={2} />
        <Spinner />
        <EmptyState title="No activity yet" body="Transactions show up here" />
        <Amount direction="out">{'−1.5000 SOL'}</Amount>
        <Avatar text="solana" tone="violet" />
      </>,
    );
    expect(within(screen.getByRole('alert')).getByText('DANGER')).toBeTruthy();
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Accepts SOL');
    expect(screen.getByRole('img', { name: 'Step 2 of 3' }).querySelectorAll('.bg-primary')).toHaveLength(2);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.getByText('No activity yet')).toBeTruthy();
    expect(screen.getByText('−1.5000 SOL').className).toContain('text-danger-text');
    expect(screen.getByText('S')).toBeTruthy();
    expect(screen.getByText('DAS')).toBeTruthy();
  });

  it('ListGroup rows are buttons when clickable and mark the selected one', () => {
    const onClick = vi.fn();
    render(
      <Card>
        <CardHeader title="Balance changes" right="Simulated just now" />
        <SectionLabel>Security</SectionLabel>
        <ListGroup>
          <ListRow title="Main" subtitle="7xKp…3fQa" selected onClick={onClick} chevron />
          <ListRow title="Static" />
        </ListGroup>
      </Card>,
    );
    const row = screen.getByRole('button', { name: /Main/ });
    expect(row.getAttribute('aria-current')).toBe('true');
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Security' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Static/ })).toBeNull();
  });
});

describe('shells', () => {
  it('PopupScreen has a 56px header with back and a title heading', () => {
    const onBack = vi.fn();
    render(<PopupScreen title="Settings" onBack={onBack} footer={<Button>Save</Button>}>content</PopupScreen>);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('ApprovalFrame shows the site host, subtitle, banner and footer', () => {
    render(
      <ApprovalFrame site={{ origin: 'https://jup.ag' }} subtitle="Requests signature · Main" banner={<div>phishing</div>} footer={<span>foot</span>}>
        body
      </ApprovalFrame>,
    );
    expect(screen.getByText('jup.ag')).toBeTruthy();
    expect(screen.getByText('Requests signature · Main')).toBeTruthy();
    expect(screen.getByText('phishing')).toBeTruthy();
    cleanup();
    render(<ApprovalFrame site={{ origin: 'clef://wallet' }} subtitle="s" footer={null}>b</ApprovalFrame>);
    expect(screen.getByText('Clef')).toBeTruthy();
  });

  it('DecisionFooter wires reject/approve, disabled and dangerPrimary', () => {
    const onReject = vi.fn();
    const onApprove = vi.fn();
    const { rerender } = render(<DecisionFooter onReject={onReject} onApprove={onApprove} approveLabel="Sign" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    expect(onReject).toHaveBeenCalledOnce();
    expect(onApprove).toHaveBeenCalledOnce();
    rerender(<DecisionFooter onReject={onReject} onApprove={onApprove} approveLabel="Sign anyway" approveDisabled dangerPrimary extra={<label><input type="checkbox" />ack</label>} />);
    const approve = screen.getByRole('button', { name: 'Sign anyway' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Reject' }).className).toContain('bg-primary');
    expect(screen.getByRole('checkbox', { name: 'ack' })).toBeTruthy();
    rerender(<DecisionFooter onReject={onReject} onApprove={onApprove} approveLabel="Sign" busy />);
    expect((screen.getByRole('button', { name: 'Sign' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
