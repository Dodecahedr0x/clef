import type { LockScheduler } from '@clef/wallet-core';

export interface AlarmsLike {
  create(name: string, info: { delayInMinutes: number }): Promise<void> | void;
  clear(name: string): Promise<boolean> | void;
  onAlarm: { addListener(cb: (alarm: { name: string }) => void): void };
}

const NAME = 'clef-autolock';
/** Chrome does not fire alarms sooner than 30 seconds. */
const MIN_DELAY_MINUTES = 0.5;

/** MV3 service workers are killed when idle, so timers must be chrome.alarms, which survive restarts. */
export class AlarmScheduler implements LockScheduler {
  private onFire: (() => void) | null = null;

  constructor(private readonly alarms: AlarmsLike) {
    alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === NAME) this.onFire?.();
    });
  }

  schedule(minutes: number, onFire: () => void): void {
    this.onFire = onFire;
    void this.alarms.create(NAME, { delayInMinutes: Math.max(MIN_DELAY_MINUTES, minutes) });
  }

  cancel(): void {
    this.onFire = null;
    void this.alarms.clear(NAME);
  }

  /** After a service-worker restart the alarm still exists; re-attach what it should do. */
  attach(onFire: () => void): void {
    this.onFire = onFire;
  }
}
