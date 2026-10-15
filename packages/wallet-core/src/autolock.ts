/** Runs `onFire` once after `minutes`; scheduling again replaces the previous timer. */
export interface LockScheduler {
  schedule(minutes: number, onFire: () => void): void;
  cancel(): void;
}

/** Re-arms a single idle timer on every user or dApp activity; when it fires, the vault locks. */
export class AutoLock {
  constructor(
    private readonly scheduler: LockScheduler,
    private readonly lock: () => Promise<void>,
    private readonly minutes: () => Promise<number>,
  ) {}

  async touch(): Promise<void> {
    this.scheduler.schedule(await this.minutes(), () => void this.lock());
  }

  stop(): void {
    this.scheduler.cancel();
  }
}
