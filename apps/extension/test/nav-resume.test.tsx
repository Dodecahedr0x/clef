import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NavProvider, useNav, useScreenDraft, type Nav } from '../lib/nav';

afterEach(cleanup);

let nav: Nav;
function Form() {
  const [amount, setAmount] = useScreenDraft('t.amount', '');
  return <input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />;
}
function Screens() {
  nav = useNav();
  return nav.route.name === 'send' ? <Form /> : <p>{nav.route.name}</p>;
}
const mount = () =>
  render(
    <NavProvider initial={{ name: 'home' }}>
      <Screens />
    </NavProvider>,
  );

describe('suspend and resume (auto-lock)', () => {
  it('comes back to the interrupted screen with what was typed', () => {
    mount();
    act(() => nav.go({ name: 'send' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1.5' } });
    act(() => nav.suspend({ name: 'unlock' }));
    expect(screen.getByText('unlock')).toBeTruthy();
    act(() => nav.resume({ name: 'home' }));
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('1.5');
    // Back still goes where it went before the lock.
    act(() => nav.back());
    expect(screen.getByText('home')).toBeTruthy();
  });

  it('forgets the draft when the screen is left normally, and resumes home when nothing was suspended', () => {
    mount();
    act(() => nav.go({ name: 'send' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2' } });
    act(() => nav.back());
    act(() => nav.go({ name: 'send' }));
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('');
    act(() => nav.resume({ name: 'home' }));
    expect(screen.getByText('home')).toBeTruthy();
  });
});
