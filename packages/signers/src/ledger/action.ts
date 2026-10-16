import { HardwareError } from '../errors';
import { toHardwareError } from './errors';

export interface Subscribable<T> {
  subscribe(observer: { next(value: T): void; error(err: unknown): void; complete(): void }): { unsubscribe(): void };
}

/** Structural view of a DMK `DeviceActionState`; real string-enum states are assignable. */
export type ActionState<O> =
  | { readonly status: 'not-started' | 'stopped' }
  | { readonly status: 'pending'; readonly intermediateValue: unknown }
  | { readonly status: 'completed'; readonly output: O }
  | { readonly status: 'error'; readonly error: unknown };

export interface DeviceActionLike<O> {
  readonly observable: Subscribable<ActionState<O>>;
  cancel(): void;
}

/** Resolves with the action's output, or rejects with a mapped HardwareError. */
export function runAction<O>(action: DeviceActionLike<O>): Promise<O> {
  return new Promise<O>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    action.observable.subscribe({
      next: (state) => {
        if (state.status === 'completed') settle(() => resolve(state.output));
        else if (state.status === 'error') settle(() => reject(toHardwareError(state.error)));
        else if (state.status === 'stopped') settle(() => reject(new HardwareError('unknown', 'Ledger: device action stopped')));
      },
      error: (err) => settle(() => reject(toHardwareError(err))),
      complete: () => settle(() => reject(new HardwareError('unknown', 'Ledger: device action ended without a result'))),
    });
  });
}

/** First value matching `pred`; rejects on stream error, completion without a match, or timeout. */
export function firstValue<T>(source: Subscribable<T>, pred: (v: T) => boolean = () => true, timeoutMs?: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let sub: { unsubscribe(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      fn();
      queueMicrotask(() => sub?.unsubscribe());
    };
    if (timeoutMs !== undefined) timer = setTimeout(() => finish(() => reject(new HardwareError('timeout', 'Ledger: timed out'))), timeoutMs);
    sub = source.subscribe({
      next: (v) => {
        if (pred(v)) finish(() => resolve(v));
      },
      error: (err) => finish(() => reject(err)),
      complete: () => finish(() => reject(new HardwareError('no-device', 'Ledger: no device selected'))),
    });
  });
}
