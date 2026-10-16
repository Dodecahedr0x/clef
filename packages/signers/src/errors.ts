export type HardwareErrorCode =
  | 'unsupported'
  | 'no-device'
  | 'locked'
  | 'app-not-open'
  | 'blind-signing-required'
  | 'rejected'
  | 'wrong-address'
  | 'disconnected'
  | 'timeout'
  | 'unknown';

export class HardwareError extends Error {
  constructor(
    readonly code: HardwareErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HardwareError';
  }
}
