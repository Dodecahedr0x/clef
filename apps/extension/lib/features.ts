/** Ledger and Keystone are built but hidden until the device checklists pass; `CLEF_HARDWARE=1 pnpm build:ext` shows them. */
export const HARDWARE_ENABLED = import.meta.env.CLEF_HARDWARE === '1';
