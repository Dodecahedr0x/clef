import type { PhishingHit } from '@clef/wallet-core';

export function BlockedSiteBanner({ hit }: { hit: PhishingHit }) {
  return (
    <div role="alert" className="flex items-center gap-2 bg-danger-bg-2 px-4 py-[10px] text-[12px] text-danger-ink-2">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
        <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17v.01" />
      </svg>
      <span className="font-semibold">This site is on a phishing list</span>
      <span className="ml-auto truncate font-mono">{hit.reason === 'fuzzy' ? `· looks like ${hit.match}` : `· listed as ${hit.match}`}</span>
    </div>
  );
}
