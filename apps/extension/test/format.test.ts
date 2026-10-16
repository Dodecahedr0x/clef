import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatPct, formatToken, formatUsd, shortAddress, timeAgo } from '../lib/format';

describe('formatUsd', () => {
  it('formats dollars with separators and two decimals', () => {
    expect(formatUsd(1284.52)).toBe('$1,284.52');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(-212.4)).toBe('−$212.40');
  });
  it('shows tiny non-zero values as <$0.01 and null as a dash', () => {
    expect(formatUsd(0.004)).toBe('<$0.01');
    expect(formatUsd(null)).toBe('—');
  });
});

describe('formatPct', () => {
  it('signs and rounds to one decimal', () => {
    expect(formatPct(2.1)).toBe('+2.1%');
    expect(formatPct(-0.83)).toBe('−0.8%');
    expect(formatPct(0)).toBe('0.0%');
    expect(formatPct(0.01)).toBe('0.0%');
    expect(formatPct(null)).toBe('—');
  });
});

describe('formatToken', () => {
  it('keeps at least two and at most four fraction digits by default', () => {
    expect(formatToken(6_210_400_000n, 9)).toBe('6.2104');
    expect(formatToken(312_400_000n, 6)).toBe('312.40');
    expect(formatToken(140_000_000n, 6)).toBe('140.00');
    expect(formatToken(1_500_000_000n, 9)).toBe('1.50');
  });
  it('truncates instead of rounding up and groups the integer part', () => {
    expect(formatToken(999_999_999n, 9)).toBe('0.9999');
    expect(formatToken(1_234_567_890_000n, 6)).toBe('1,234,567.89');
  });
  it('honours max and zero-decimal tokens and negatives', () => {
    expect(formatToken(123_456_789n, 9, 9)).toBe('0.123456789');
    expect(formatToken(42n, 0)).toBe('42');
    expect(formatToken(-1_500_000n, 6)).toBe('−1.50');
  });
  it('shows a non-zero dust amount below the max precision as <0.0001', () => {
    expect(formatToken(5n, 9)).toBe('<0.0001');
  });
});

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());
  it('describes past timestamps relative to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
    const now = Date.now();
    expect(timeAgo(now - 10_000)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000)).toBe('3 h ago');
    expect(timeAgo(now - 2 * 86_400_000)).toBe('2 d ago');
    expect(timeAgo(now - 40 * 86_400_000)).toMatch(/^\d{1,2} \w{3}( \d{4})?$/);
  });
});

describe('shortAddress', () => {
  it('keeps 4 characters on each side with a real ellipsis', () => {
    expect(shortAddress('7xKpWm2QdL9vHc4TrB8nYeX5uJ3kPs6AGf1zNq7R3fQa')).toBe('7xKp…3fQa');
    expect(shortAddress('short')).toBe('short');
  });
});
