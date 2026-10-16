import { Button, Logo } from '../../../components';
import { useNav } from '../../../lib/nav';

export function WelcomeScreen() {
  const nav = useNav();
  const toImport = () => nav.go({ name: 'create-password', next: 'import' });
  return (
    <div className="flex h-[600px] w-[360px] flex-col overflow-hidden bg-bg px-5 pb-5 font-sans text-ink">
      <div className="-mx-5 flex h-[190px] items-center justify-center">
        <div className="w-full"><Logo size={84} staff /></div>
      </div>
      <h1 className="m-0 text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">Know what<br />you sign.</h1>
      <p className="mt-2.5 text-[14px] leading-normal text-muted">Clef reads every transaction and tells you, in plain words, what it will do.</p>
      <div className="mt-auto flex flex-col gap-2.5">
        <Button block onClick={() => nav.go({ name: 'create-password', next: 'create' })}>Create a new wallet</Button>
        <Button block variant="secondary" onClick={toImport}>I already have a wallet</Button>
        <div className="flex justify-center gap-4 pt-1 text-[12px]">
          <button type="button" className="border-0 bg-transparent p-0 text-info hover:text-info-ink" onClick={toImport}>Connect Ledger or Keystone</button>
          <button type="button" className="border-0 bg-transparent p-0 text-info hover:text-info-ink" onClick={toImport}>Watch an address</button>
        </div>
      </div>
    </div>
  );
}
