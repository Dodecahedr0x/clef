import { HardwareError } from '@clef/signers';

const COPY: Record<string, string> = {
  unsupported: "This browser can't reach USB devices. Use Chrome 137 or newer.",
  'no-device': 'No Ledger selected. Plug it in, unlock it and try again.',
  locked: 'Your Ledger is locked. Enter your PIN on the device and try again.',
  'app-not-open': 'Open the Solana app on your Ledger and try again.',
  'blind-signing-required': 'Enable blind signing in the Solana app settings on your Ledger.',
  rejected: 'The request was rejected on the device.',
  'wrong-address': 'The device returned a different address than expected.',
  disconnected: 'The device was disconnected. Reconnect it and try again.',
  timeout: 'The device did not respond in time. Try again.',
};

export function hardwareMessage(e: unknown): string {
  if (e instanceof HardwareError) return COPY[e.code] ?? e.message;
  if (e instanceof Error) {
    if (e.name === 'NotAllowedError') return 'Camera access was denied. Allow the camera for Clef and try again.';
    if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return 'No camera found. Connect a camera and try again.';
    if (e.name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
    return e.message;
  }
  return String(e);
}
