import { describe, expect, it, vi } from 'vitest';
import { AutoLock, type LockScheduler } from '../src';

function fakeScheduler() {
  let onFire: (() => void) | null = null;
  return {
    at: null as number | null,
    schedule(minutes: number, cb: () => void) {
      this.at = minutes;
      onFire = cb;
    },
    cancel() {
      this.at = null;
      onFire = null;
    },
    fire() {
      onFire?.();
    },
  } satisfies LockScheduler & { at: number | null; fire(): void };
}

describe('AutoLock', () => {
  it('locks after the configured idle time', async () => {
    const lock = vi.fn(async () => {});
    const sched = fakeScheduler();
    await new AutoLock(sched, lock, async () => 15).touch();
    expect(sched.at).toBe(15);
    sched.fire();
    expect(lock).toHaveBeenCalledOnce();
  });

  it('re-arms with the current setting on every activity', async () => {
    let minutes = 15;
    const sched = fakeScheduler();
    const auto = new AutoLock(sched, async () => {}, async () => minutes);
    await auto.touch();
    minutes = 5;
    await auto.touch();
    expect(sched.at).toBe(5);
  });

  it('cancels when stopped', async () => {
    const lock = vi.fn(async () => {});
    const sched = fakeScheduler();
    const auto = new AutoLock(sched, lock, async () => 15);
    await auto.touch();
    auto.stop();
    expect(sched.at).toBeNull();
    sched.fire();
    expect(lock).not.toHaveBeenCalled();
  });
});
