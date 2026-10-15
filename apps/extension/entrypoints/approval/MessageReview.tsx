import { inspectMessage } from '@clef/wallet-core';

export function messageDanger(message: Uint8Array, origin: string): boolean {
  return inspectMessage(message, origin).danger;
}

export function MessageReview({ message, origin }: { message: Uint8Array; origin: string }) {
  const m = inspectMessage(message, origin);
  return (
    <section className="space-y-3">
      {m.looksLikeTransaction && (
        <p className="rounded-lg border border-red-500 bg-red-950 px-3 py-2 text-sm text-red-200">
          <strong className="mr-1">DANGER</strong>This message is a Solana transaction. Signing it could authorize that transaction.
        </p>
      )}
      {m.kind === 'siws' && !m.domainMatches && (
        <p className="rounded-lg border border-red-500 bg-red-950 px-3 py-2 text-sm text-red-200">
          <strong className="mr-1">DANGER</strong>This sign-in request is for {m.domain}, not for the site asking.
        </p>
      )}
      {m.kind === 'siws' && (
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(m.fields).map(([k, v]) => (
              <tr key={k} className="align-top">
                <td className="pr-2 text-gray-400">{k}</td>
                <td className="break-all">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m.kind === 'text' && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-900 p-3 font-mono text-sm">{m.text}</pre>}
      {m.kind === 'binary' && (
        <>
          <p className="text-sm text-amber-300">This message is binary data, not text.</p>
          <pre className="max-h-72 overflow-auto break-all rounded-lg bg-gray-900 p-3 font-mono text-xs">{m.hex}</pre>
        </>
      )}
    </section>
  );
}
