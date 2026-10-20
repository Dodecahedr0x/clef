import { Button, EmptyState, PopupScreen } from '../../../components';
import { useNav } from '../../../lib/nav';

/** Watch-only accounts have no key: Send and Swap are off, and say why before any form is filled. */
export const VIEW_ONLY_HINT = 'View-only account — switch to one you can sign with.';
export const VIEW_ONLY_HINT_ID = 'view-only-hint';

const isMoving = (route: string) => route === 'send' || route === 'swap';

/** Props for an action button: disabled and described by the hint when the account can't sign. */
export function actionGate(route: string, viewOnly: boolean): { disabled?: true; 'aria-describedby'?: string } {
  return viewOnly && isMoving(route) ? { disabled: true, 'aria-describedby': VIEW_ONLY_HINT_ID } : {};
}

export function ViewOnlyHint({ className = '' }: { className?: string }) {
  const nav = useNav();
  return (
    <p id={VIEW_ONLY_HINT_ID} className={`m-0 text-xs text-muted ${className}`}>
      {VIEW_ONLY_HINT}{' '}
      <button type="button" onClick={() => nav.go({ name: 'accounts' })} className="border-0 bg-transparent p-0 text-xs font-semibold text-info underline">
        Switch account
      </button>
    </p>
  );
}

/** Send or Swap reached anyway (a deep link, an account switch elsewhere). */
export function ViewOnlyScreen({ title }: { title: string }) {
  const nav = useNav();
  return (
    <PopupScreen title={title} onBack={nav.back}>
      <EmptyState
        title="This account is view-only"
        body="Clef has no key for it, so it can't send or swap. Switch to an account you can sign with."
        action={<Button onClick={() => nav.go({ name: 'accounts' })}>Switch account</Button>}
      />
    </PopupScreen>
  );
}
