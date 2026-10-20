import { Alert } from './layout';

type Text = { tone: 'neutral' | 'danger'; title: string; body?: string; detail?: string; rpc?: boolean };

/**
 * A failure in words (see lib/error-text): the title says what happened, the body what to do, the raw message
 * waits behind "Details". A cancel is the user's own choice, so it reads as a plain note, not an error.
 */
export function ErrorNote({ text, onRetry, onRpc }: { text: Text; onRetry?: () => void; onRpc?: () => void }) {
  if (text.tone === 'neutral') {
    return (
      <p role="status" className="m-0 text-xs text-muted">
        {text.title}
      </p>
    );
  }
  const actions = [
    onRetry && { label: 'Try again', run: onRetry },
    text.rpc && onRpc && { label: 'Change RPC', run: onRpc },
  ].filter((a): a is { label: string; run: () => void } => !!a);
  return (
    <Alert severity="danger" title={text.title}>
      {text.body}
      {text.detail && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted underline">Details</summary>
          <p className="m-0 mt-1 font-mono text-2xs break-all text-muted">{text.detail}</p>
        </details>
      )}
      {actions.length > 0 && (
        <span className="mt-1.5 flex gap-3">
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={a.run} className="border-0 bg-transparent p-0 text-xs font-semibold text-info underline">
              {a.label}
            </button>
          ))}
        </span>
      )}
    </Alert>
  );
}
