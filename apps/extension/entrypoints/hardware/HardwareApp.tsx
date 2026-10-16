import { HardwareShell } from './shared';
import { KeystoneConnect } from './KeystoneConnect';
import { LedgerConnect } from './LedgerConnect';

export function HardwareApp({ kind }: { kind: 'ledger' | 'keystone' }) {
  if (kind === 'ledger') return <LedgerConnect />;
  if (kind === 'keystone') return <KeystoneConnect />;
  return (
    <HardwareShell title="Connect device">
      <p className="m-0 p-4 text-[14px] text-muted">Unknown device. Open this page from Clef's Add account menu.</p>
    </HardwareShell>
  );
}
