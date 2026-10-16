import { HardwareError, type HardwareErrorCode } from '../errors';

const BY_STATUS_WORD: Record<string, HardwareErrorCode> = {
  '6808': 'blind-signing-required',
  '6985': 'rejected',
  '5501': 'rejected',
  '5515': 'locked',
  '6e00': 'app-not-open',
  '6d00': 'app-not-open',
  '6a83': 'app-not-open',
  '6511': 'app-not-open',
  '6807': 'app-not-open',
};

const BY_TAG: Record<string, HardwareErrorCode> = {
  RefusedByUserDAError: 'rejected',
  ActionRefusedError: 'rejected',
  DeviceLockedError: 'locked',
  UnsupportedApplicationDAError: 'app-not-open',
  DisconnectError: 'disconnected',
  DeviceDisconnectedWhileSendingError: 'disconnected',
  DeviceNotRecognizedError: 'disconnected',
  DeviceSessionNotFound: 'disconnected',
  ReconnectionFailedError: 'disconnected',
  WebHidSendReportError: 'disconnected',
  SendApduTimeoutError: 'timeout',
  SendCommandTimeoutError: 'timeout',
  NoAccessibleDeviceError: 'no-device',
  WebHidTransportNotSupportedError: 'unsupported',
  TransportNotSupportedError: 'unsupported',
};

function statusWord(v: unknown): string | null {
  if (typeof v === 'number') return v.toString(16).padStart(4, '0');
  if (typeof v === 'string' && /^(0x)?[0-9a-f]{4}$/i.test(v)) return v.toLowerCase().replace(/^0x/, '');
  return null;
}

/** Walks a DMK error and its `originalError` chain; status words win over tags. */
export function toHardwareError(error: unknown): HardwareError {
  if (error instanceof HardwareError) return error;
  let tagCode: HardwareErrorCode | undefined;
  let message: string | undefined;
  let cur: unknown = error;
  for (let depth = 0; depth < 4 && cur !== null && typeof cur === 'object'; depth++) {
    const e = cur as { _tag?: unknown; errorCode?: unknown; message?: unknown; originalError?: unknown };
    const sw = statusWord(e.errorCode);
    if (sw && BY_STATUS_WORD[sw]) return new HardwareError(BY_STATUS_WORD[sw], `Ledger: ${String(e.message ?? sw)} (0x${sw})`);
    if (typeof e._tag === 'string') tagCode ??= BY_TAG[e._tag];
    if (typeof e.message === 'string') message ??= sw ? `${e.message} (0x${sw})` : e.message;
    else if (sw) message ??= `status 0x${sw}`;
    cur = e.originalError;
  }
  if (!message && typeof error === 'object' && error && typeof (error as { _tag?: unknown })._tag === 'string') {
    message = (error as { _tag: string })._tag;
  }
  return new HardwareError(tagCode ?? 'unknown', `Ledger: ${message ?? String(error)}`);
}
