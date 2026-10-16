import type { DetailLevel } from '@clef/explain';
import { useState, type ReactNode } from 'react';
import {
  AddressText, Alert, Amount, AnimatedQr, ApprovalFrame, Avatar, Button, Card, CardHeader, Chips, DecisionFooter, DetailLevelSwitch, EmptyState, Icon,
  IconButton, ListGroup, ListRow, Logo, NetworkSwitch, PasswordField, Pill, PopupScreen, QrCode, SectionLabel, Segmented, Spinner, StepDots, Tabs,
  TextField, Toggle, Tooltip, type IconName,
} from '../../components';

const ADDR = '7xKpWm2QdL9vHc4TrB8nYeX5uJ3kPs6AGf1zNq7R3fQa';
const ICONS: IconName[] = ['back', 'close', 'settings', 'send', 'receive', 'swap', 'history', 'eye', 'eye-off', 'copy', 'share', 'lock', 'check', 'info', 'warn',
  'danger', 'shield-check', 'shield-x', 'chevron-down', 'chevron-right', 'chevron-up', 'plus', 'refresh', 'sliders', 'filter', 'instructions', 'changes',
  'relations', 'logs', 'details', 'camera', 'usb', 'qr', 'key', 'clef', 'spinner'];
const FRAMES = Array.from({ length: 8 }, (_, i) => `UR:SOL-SIGN-REQUEST/${i + 1}-8/LPAOAYCFADYKCYJTFGJOGHHDQZIEHDECTPIDKTDSFLTDIABIEKBWZCNSWDVLYKKYTBLONYKSSDLHLYTIDGL${i}`);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 border-b border-line-soft pb-1 font-mono text-[14px] font-semibold">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export function KitchenSink() {
  const [seg, setSeg] = useState<'basic' | 'intermediate' | 'expert'>('intermediate');
  const [level, setLevel] = useState<DetailLevel>('basic');
  const [net, setNet] = useState<'mainnet' | 'devnet'>('mainnet');
  const [tab, setTab] = useState<'tokens' | 'activity' | 'sites'>('tokens');
  const [chip, setChip] = useState<'all' | 'sent' | 'received' | 'swaps' | 'blocked'>('all');
  const [spam, setSpam] = useState(true);
  const [ack, setAck] = useState(false);

  return (
    <div className="flex flex-col gap-8 bg-bg p-8 font-sans text-ink">
      <h1 className="m-0 flex items-center gap-2 font-mono text-[28px] font-semibold tracking-[-0.03em]"><Logo size={28} />clef components</h1>

      <Section title="Icon">
        {ICONS.map((n) => <span key={n} className="flex w-20 flex-col items-center gap-1 text-[12px] text-muted"><Icon name={n} className="text-ink" />{n}</span>)}
      </Section>

      <Section title="Logo">
        <Logo />
        <div className="w-[312px]"><Logo staff size={96} /></div>
      </Section>

      <Section title="Button / IconButton">
        <Button>Sign</Button>
        <Button variant="secondary">Reject</Button>
        <Button variant="ghost" size="md">Ghost</Button>
        <Button variant="danger-outline" size="sm">Revoke</Button>
        <Button variant="dark" size="xs">All</Button>
        <Button icon="copy">Copy</Button>
        <Button disabled>Sign anyway</Button>
        <Button block variant="secondary" icon="plus">Add account</Button>
        <IconButton label="Settings" icon="settings" />
        <IconButton label="Back" icon="back" size={40} />
      </Section>

      <Section title="Segmented / DetailLevelSwitch / NetworkSwitch">
        <div className="w-[320px]">
          <Segmented fill size="md" ariaLabel="Signing detail level" value={seg} onChange={setSeg} options={[{ value: 'basic', label: 'Basic' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'expert', label: 'Expert' }]} />
        </div>
        <DetailLevelSwitch value={level} onChange={setLevel} />
        <DetailLevelSwitch compact value={level} onChange={setLevel} />
        <NetworkSwitch value={net} onChange={setNet} />
        <NetworkSwitch compact value={net} onChange={setNet} />
      </Section>

      <Section title="Tabs / Chips">
        <div className="w-[328px]"><Tabs ariaLabel="Portfolio sections" value={tab} onChange={setTab} tabs={[{ id: 'tokens', label: 'Tokens' }, { id: 'activity', label: 'Activity' }, { id: 'sites', label: 'Sites' }]} /></div>
        <Chips ariaLabel="Filter" value={chip} onChange={setChip} chips={[{ id: 'all', label: 'All' }, { id: 'sent', label: 'Sent' }, { id: 'received', label: 'Received' }, { id: 'swaps', label: 'Swaps' }, { id: 'blocked', label: 'Blocked' }]} />
      </Section>

      <Section title="Card / CardHeader / SectionLabel / ListGroup / ListRow">
        <Card className="w-[360px]">
          <CardHeader title="Balance changes" right="Simulated just now" />
          <div className="flex items-center gap-3 px-3.5 py-3">
            <Avatar text="Solana" tone="violet" size={32} />
            <span className="flex-1 text-[14px]">Solana</span>
            <Amount direction="out">{'−1.5000 SOL'}</Amount>
          </div>
        </Card>
        <Card tone="warn" dashed padded className="w-[300px]"><span className="text-[12px] text-warn-ink">Dashed warn card, padded</span></Card>
        <div className="flex w-[336px] flex-col gap-1.5">
          <SectionLabel right="2">Recovery phrase</SectionLabel>
          <ListGroup>
            <ListRow title="Main" subtitle={<AddressText address={ADDR} />} leading={<Avatar text="M" tone="info" size={24} />} trailing={<><span className="text-[14px] text-ink">$1,284.52</span><span>{'✓ selected'}</span></>} selected onClick={() => undefined} />
            <ListRow title="Connected sites" trailing="3" chevron onClick={() => undefined} />
            <ListRow title="Static row" />
          </ListGroup>
        </div>
      </Section>

      <Section title="Pill / Alert">
        <Pill>neutral</Pill><Pill tone="ok">DAS</Pill><Pill tone="warn">temp</Pill><Pill tone="danger">closed</Pill><Pill tone="info">info</Pill><Pill tone="primary">new</Pill><Pill tone="violet">IDL</Pill>
        <Pill tone="danger" solid>DANGER</Pill><Pill tone="warn" solid>WARN</Pill>
        <div className="flex w-[368px] flex-col gap-3">
          <Alert severity="info">Accepts SOL and any Solana token on <strong>Mainnet</strong>. Don’t send from other chains.</Alert>
          <Alert severity="ok" title="No warnings">Accounts verified · only your own tokens move</Alert>
          <Alert severity="warn" title="Simulation incomplete">This RPC cannot simulate transactions back-to-back.</Alert>
          <Alert severity="danger">Anyone with these words owns your funds.</Alert>
          <Alert severity="danger" label="DANGER" title="Owner change">SetAuthority makes <strong>5Qz8…uN4d</strong> the owner of your USDC account.</Alert>
        </div>
      </Section>

      <Section title="Avatar / AddressText / Amount">
        <Avatar text="Solana" tone="violet" /><Avatar text="USD Coin" tone="info" /><Avatar text="Jupiter" tone="primary" /><Avatar text="jup.ag" square size={32} />
        <AddressText address={ADDR} />
        <span className="w-[300px] text-[14px]"><AddressText address={ADDR} mode="groups" /></span>
        <span className="w-[300px] text-[12px]"><AddressText address={ADDR} mode="full" /></span>
        <Amount direction="in">+212.40 USDC</Amount><Amount direction="out">{'−1.5000 SOL'}</Amount><Amount>0.000105 SOL</Amount>
      </Section>

      <Section title="TextField / PasswordField / Toggle">
        <div className="flex w-[320px] flex-col gap-4">
          <TextField label="Recipient" mono placeholder="Address or contact" />
          <TextField label="Amount" error="More than your balance" defaultValue="99" trailing={<Button variant="ghost" size="xs">Max</Button>} />
          <PasswordField label="Password" defaultValue="correct-horse" />
        </div>
        <div className="w-[320px] rounded-[12px] border border-line bg-surface">
          <Toggle label="Hide spam tokens" checked={spam} onChange={setSpam} />
          <Toggle label="Error reports" description="Send scrubbed crash details" checked={false} onChange={() => undefined} />
        </div>
      </Section>

      <Section title="QrCode / AnimatedQr / StepDots / Spinner / Tooltip">
        <div className="rounded-[20px] border border-line bg-surface p-4"><QrCode value={ADDR} size={184} logo /></div>
        <div className="rounded-[18px] border border-line bg-surface p-3.5"><AnimatedQr frames={FRAMES} size={232} /></div>
        <StepDots total={3} current={1} />
        <StepDots total={3} current={2} />
        <Spinner />
        <Tooltip tip="Account relationships">
          <a href="#rel" aria-label="Account relationships" className="flex size-10 items-center justify-center rounded-[10px] bg-surface-2 text-ink"><Icon name="relations" /></a>
        </Tooltip>
      </Section>

      <Section title="EmptyState">
        <Card className="w-[320px]"><EmptyState title="No activity yet" body="Transactions you sign or receive show up here." action={<Button size="sm" variant="secondary">Receive</Button>} /></Card>
      </Section>

      <Section title="PopupScreen">
        <div className="border border-line">
          <PopupScreen title="Settings" onBack={() => undefined} right={<Button variant="secondary" size="sm" icon="lock" className="rounded-full">Lock now</Button>} footer={<Button block>Continue</Button>}>
            <div className="flex flex-col gap-1.5 px-3 py-2.5">
              <SectionLabel>Signing detail</SectionLabel>
              <Card padded><Segmented fill size="md" ariaLabel="Signing detail" value={seg} onChange={setSeg} options={[{ value: 'basic', label: 'Basic' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'expert', label: 'Expert' }]} /></Card>
            </div>
          </PopupScreen>
        </div>
      </Section>

      <Section title="ApprovalFrame / DecisionFooter">
        <div className="h-[680px] border border-line">
          <ApprovalFrame
            site={{ origin: 'https://airdrop-claim.example' }}
            subtitle="Requests signature · Main"
            headerRight={<DetailLevelSwitch compact value={level} onChange={setLevel} />}
            banner={<div className="flex items-center gap-2 bg-danger-bg-2 px-4 py-2.5 text-[12px] text-danger-ink-2"><Icon name="danger" size={16} className="text-danger" />This site is on a phishing list</div>}
            footer={
              <DecisionFooter
                dangerPrimary
                approveDisabled={!ack}
                onReject={() => undefined}
                onApprove={() => undefined}
                approveLabel="Sign anyway"
                extra={<label className="flex min-h-11 items-center gap-2.5 text-[14px]"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-5 accent-danger" />I understand I may lose these funds</label>}
              />
            }
          >
            <div className="flex flex-col gap-3.5 px-4 pt-5">
              <h1 className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.02em]">Give away control of your USDC account</h1>
              <Alert severity="danger" label="DANGER" title="Owner change">Token Program · SetAuthority makes a new address the owner of your USDC account.</Alert>
            </div>
          </ApprovalFrame>
        </div>
        <div className="h-[200px] border border-line">
          <ApprovalFrame site={{ origin: 'clef://wallet' }} subtitle="Send · Main" footer={<DecisionFooter busy onReject={() => undefined} onApprove={() => undefined} approveLabel="Sign" />}>
            <span />
          </ApprovalFrame>
        </div>
      </Section>
    </div>
  );
}
