import { HARDWARE_ENABLED } from '../../lib/features';
import { HardwareShell } from './shared';
import { KeystoneConnect } from './KeystoneConnect';
import { LedgerConnect } from './LedgerConnect';

export function HardwareApp({ kind }: { kind: 'ledger' | 'keystone' }) {
  if (!HARDWARE_ENABLED) {
    return (
      <HardwareShell title="Connect device">
        <p className="m-0 p-4 text-sm text-muted">Hardware wallets are not available in this version of Clef yet.</p>
      </HardwareShell>
    );
  }
  if (kind === 'ledger') return <LedgerConnect />;
  if (kind === 'keystone') return <KeystoneConnect />;
  return (
    <HardwareShell title="Connect device">
      <p className="m-0 p-4 text-sm text-muted">Unknown device. Open this page from Clef's Add account menu.</p>
    </HardwareShell>
  );
}
