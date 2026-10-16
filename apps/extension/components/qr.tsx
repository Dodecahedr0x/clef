import { useEffect, useMemo, useState } from 'react';
import { encode } from 'uqr';

// One path for all dark modules keeps the DOM small (a v10 code has 3249 modules).
function modulesPath(data: boolean[][]): string {
  let d = '';
  data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
  return d;
}

function QrMatrix({ data, size, label }: { data: boolean[][]; size: number; label: string }) {
  const n = data.length;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" data-modules={n}>
      <path d={modulesPath(data)} fill="var(--color-ink, #14171F)" />
    </svg>
  );
}

// logo: error correction H so the centred mark (about 4% of the area) stays recoverable.
export function QrCode({ value, size, logo = false, label = 'QR code' }: { value: string; size: number; logo?: boolean; label?: string }) {
  const data = useMemo(() => encode(value, { ecc: logo ? 'H' : 'M', border: 0 }).data, [value, logo]);
  const badge = Math.round(size * 0.196);
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <QrMatrix data={data} size={size} label={label} />
      {logo && (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[10px] bg-surface shadow-[0_0_0_4px_#FFFFFF]"
          style={{ width: badge, height: badge }}
        >
          <svg width={badge * 0.72} height={badge * 0.72} viewBox="0 0 24 24" fill="none" stroke="#4A6B12" strokeWidth={1.8} strokeLinecap="round">
            <path d="M3 7h18M3 12h18M3 17h18" strokeOpacity="0.35" />
            <circle cx="9" cy="12" r="3.2" fill="#FFFFFF" />
            <path d="M12.2 12H20M17 12v3M20 12v2" />
          </svg>
        </span>
      )}
    </div>
  );
}

const MAX_DOTS = 12;

// All frames are encoded at the largest version among them so the code does not jump in size while looping.
export function AnimatedQr({ frames, size, intervalMs = 250, label = 'Animated QR code' }: { frames: string[]; size: number; intervalMs?: number; label?: string }) {
  const matrices = useMemo(() => {
    const minVersion = Math.max(1, ...frames.map((f) => encode(f, { ecc: 'L', border: 0 }).version));
    return frames.map((f) => encode(f, { ecc: 'L', border: 0, minVersion }).data);
  }, [frames]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    if (frames.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % frames.length), intervalMs);
    return () => clearInterval(t);
  }, [frames, intervalMs]);
  const current = matrices[index] ?? matrices[0];
  if (!current) return null;
  const total = frames.length;
  return (
    <div className="flex flex-col items-center gap-3">
      <QrMatrix data={current} size={size} label={label} />
      <div className="flex items-center gap-2 text-[12px] text-muted">
        {total <= MAX_DOTS && (
          <div aria-hidden="true" className="flex gap-1">
            {frames.map((_, i) => <span key={i} className={`h-1 w-3.5 rounded-[2px] ${i <= index ? 'bg-primary' : 'bg-line-strong'}`} />)}
          </div>
        )}
        <span aria-live="off" data-frame={index}>{`Part ${index + 1} of ${total}${total > 1 ? ' · looping' : ''}`}</span>
      </div>
    </div>
  );
}
