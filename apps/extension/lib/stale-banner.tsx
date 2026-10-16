import { useEffect, useState } from 'react';
import { backgroundBuild, PAGE_BUILD } from './api';

/** Shown when this page was rebuilt but the background still runs the old build (the extension was not reloaded). */
export function StaleBackgroundBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let live = true;
    void backgroundBuild().then((b) => live && setStale(b !== PAGE_BUILD));
    return () => {
      live = false;
    };
  }, []);
  if (!stale) return null;
  return (
    <div role="alert" className="border-b border-warn-line bg-warn-bg px-4 py-2 text-[12px] leading-snug text-warn-ink">
      <strong>Reload Clef.</strong> It was updated but its background still runs the old version: open your browser's extensions page and click
      Clef's reload button.
    </div>
  );
}
