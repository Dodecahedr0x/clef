export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'primary' | 'violet';

// soft: tinted surface; solid: filled badge; card: tinted card surface + border.
export const TONE: Record<Tone, { soft: string; solid: string; card: string; avatar: string }> = {
  neutral: { soft: 'bg-surface-2 text-ink-2', solid: 'bg-ink text-white', card: 'bg-surface border-line', avatar: 'bg-surface-2 text-ink-2' },
  ok: { soft: 'bg-ok-bg text-ok-ink', solid: 'bg-ok text-white', card: 'bg-ok-bg border-ok-line', avatar: 'bg-ok-bg text-ok' },
  warn: { soft: 'bg-warn-bg text-warn-ink', solid: 'bg-warn text-white', card: 'bg-warn-bg border-warn-line', avatar: 'bg-warn-bg text-warn' },
  danger: { soft: 'bg-danger-bg-2 text-danger-ink-2', solid: 'bg-danger text-white', card: 'bg-danger-bg border-danger-line', avatar: 'bg-danger-bg-2 text-danger' },
  info: { soft: 'bg-info-bg text-info-ink', solid: 'bg-info text-white', card: 'bg-info-bg border-info-bg', avatar: 'bg-info-bg text-info' },
  primary: { soft: 'bg-primary-tint text-primary', solid: 'bg-primary text-white', card: 'bg-primary-bg border-primary-line', avatar: 'bg-primary-tint text-primary' },
  violet: { soft: 'bg-violet-bg text-violet', solid: 'bg-violet text-white', card: 'bg-violet-bg border-violet-bg', avatar: 'bg-violet-bg text-violet' },
};
